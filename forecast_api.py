from __future__ import annotations

from pathlib import Path
from typing import Any

import polars as pl
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Forecast API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_CACHE: dict[str, Any] = {
    "rows": [],
    "mae": None,
    "locations": [],
}

DATA_DIR = Path(__file__).parent / "data"
ITEMS_GLOB = "items*.parquet"
TRANSACTIONS_GLOB = "transactions*.parquet"


def _pick_latest_file(pattern: str) -> Path | None:
    candidates = sorted(
        DATA_DIR.glob(pattern),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return candidates[0] if candidates else None


def _pick_items_path() -> Path:
    latest = _pick_latest_file(ITEMS_GLOB)
    if latest is not None:
        return latest
    raise HTTPException(
        status_code=400,
        detail="Không tìm thấy file items*.parquet trong data/",
    )


def _pick_transactions_path() -> Path:
    latest = _pick_latest_file(TRANSACTIONS_GLOB)
    if latest is not None:
        return latest
    raise HTTPException(
        status_code=400,
        detail="Không tìm thấy file transactions*.parquet trong data/",
    )


def _validate_columns(df: pl.DataFrame, required: list[str], source: str) -> None:
    missing = [col for col in required if col not in df.columns]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"{source} thiếu cột bắt buộc: {', '.join(missing)}",
        )


def _run_forecast(items_df: pl.DataFrame, transactions_df: pl.DataFrame) -> tuple[pl.DataFrame, float]:
    # Keep column requirements identical to source algorithm.
    _validate_columns(items_df, ["item_id"], "items.parquet")
    _validate_columns(transactions_df, ["updated_date", "location", "item_id"], "transactions.parquet")

    transactions = transactions_df.with_columns(pl.col("updated_date").dt.date().alias("date"))

    min_date = transactions.select(pl.col("date").min()).item()
    if min_date is None:
        raise HTTPException(status_code=400, detail="transactions.parquet không có dữ liệu ngày hợp lệ")

    transactions = transactions.with_columns(
        ((pl.col("date") - pl.lit(min_date)).dt.total_days() // 7).alias("week_node")
    )

    weekly_sales = (
        transactions
        .filter(pl.col("week_node").is_not_null())
        .group_by(["location", "item_id", "week_node"])
        .agg(pl.len().alias("qty"))
    )

    if weekly_sales.height == 0:
        raise HTTPException(status_code=400, detail="Không thể tạo weekly sales từ transactions.parquet")

    max_week = weekly_sales.select(pl.max("week_node")).item()

    train = weekly_sales.filter(pl.col("week_node") < max_week)
    test = weekly_sales.filter(pl.col("week_node") == max_week)

    if train.height == 0 or test.height == 0:
        raise HTTPException(status_code=400, detail="Dữ liệu không đủ để tách train/test theo tuần")

    agg = (
        train
        .sort("week_node")
        .group_by(["location", "item_id"])
        .agg([
            pl.col("qty").tail(2).mean().alias("ma2"),
            pl.col("qty").mean().alias("avg_all"),
            (pl.col("qty").tail(2).mean() - pl.col("qty").slice(-4, 2).mean()).alias("trend"),
        ])
        .fill_null(0)
    )

    global_avg = train.select(pl.mean("qty")).item()

    pred = (
        agg
        .with_columns(
            (
                0.6 * pl.col("ma2")
                + 0.3 * pl.col("avg_all")
                + 0.5 * pl.col("trend")
            ).alias("weekly_pred")
        )
        .with_columns(
            pl.when(pl.col("weekly_pred") < 0)
            .then(global_avg)
            .otherwise(pl.col("weekly_pred"))
            .alias("qty")
        )
        .with_columns(pl.col("qty").round(0).cast(pl.Int32))
        .select(["location", "item_id", "qty"])
    )

    gt = (
        test
        .group_by(["location", "item_id"])
        .agg(pl.sum("qty").alias("actual_qty"))
    )

    eval_df = (
        pred
        .join(gt, on=["location", "item_id"], how="inner")
        .with_columns((pl.col("qty") - pl.col("actual_qty")).abs().alias("abs_error"))
    )

    mae = eval_df.select(pl.mean("abs_error")).item()
    return pred, float(mae or 0.0)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/forecast/run")
def run_forecast_api() -> dict[str, Any]:
    items_path = _pick_items_path()
    transactions_path = _pick_transactions_path()

    items_df = pl.read_parquet(str(items_path))
    transactions_df = pl.read_parquet(str(transactions_path))

    pred_df, mae = _run_forecast(items_df, transactions_df)

    rows = pred_df.with_columns(
        [
            pl.col("item_id").cast(pl.Utf8),
            pl.col("location").cast(pl.Utf8),
        ]
    ).to_dicts()

    # Sort by item first so each page mixes multiple locations,
    # instead of grouping entire pages by a single location code.
    rows.sort(key=lambda r: (str(r["item_id"]), str(r["location"])))

    locations = sorted({str(r["location"]) for r in rows})
    _CACHE["rows"] = rows
    _CACHE["mae"] = mae
    _CACHE["locations"] = locations

    return {
        "message": "Forecast completed from local data",
        "mae": round(mae, 4),
        "total_rows": len(rows),
        "locations": locations,
        "items_file": str(items_path.name),
        "transactions_file": str(transactions_path.name),
    }


@app.get("/api/forecast/results")
def get_forecast_results(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    location: str | None = Query(None),
) -> dict[str, Any]:
    rows = _CACHE["rows"]
    mae = _CACHE["mae"]

    if not rows or mae is None:
        raise HTTPException(status_code=400, detail="Chưa có kết quả forecast. Hãy chạy /api/forecast/run trước")

    filtered = rows
    if location:
        filtered = [r for r in rows if str(r["location"]) == location]

    total_rows = len(filtered)
    if total_rows == 0:
        return {
            "rows": [],
            "mae": round(float(mae), 4),
            "page": page,
            "page_size": page_size,
            "total_rows": 0,
            "total_pages": 0,
            "locations": _CACHE["locations"],
        }

    total_pages = (total_rows + page_size - 1) // page_size
    page = min(page, total_pages)

    start = (page - 1) * page_size
    end = start + page_size

    return {
        "rows": filtered[start:end],
        "mae": round(float(mae), 4),
        "page": page,
        "page_size": page_size,
        "total_rows": total_rows,
        "total_pages": total_pages,
        "locations": _CACHE["locations"],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("forecast_api:app", host="127.0.0.1", port=8001, reload=True)

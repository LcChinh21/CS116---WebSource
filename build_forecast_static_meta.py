from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import polars as pl

from forecast_api import _pick_items_path, _pick_transactions_path, _run_forecast


def main() -> None:
    data_dir = Path(__file__).parent / "data"
    output_path = data_dir / "forecast_static_meta.json"

    items_path = _pick_items_path()
    transactions_path = _pick_transactions_path()

    items_df = pl.read_parquet(str(items_path))
    transactions_df = pl.read_parquet(str(transactions_path))

    pred_df, mae = _run_forecast(items_df, transactions_df)

    payload = {
        "mae": round(float(mae), 4),
        "total_rows": int(pred_df.height),
        "items_file": items_path.name,
        "transactions_file": transactions_path.name,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }

    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {output_path}")
    print(payload)


if __name__ == "__main__":
    main()

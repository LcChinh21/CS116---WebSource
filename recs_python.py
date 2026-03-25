from __future__ import annotations

from collections import defaultdict, Counter
from pathlib import Path
from typing import Optional

import polars as pl
from tqdm import tqdm

# =============================
# CẤU HÌNH
# =============================
K_RECS = 15      # Số lượng gợi ý Top K cho Similar Products
K_FBT = 10       # Số lượng gợi ý Top K cho FBT (luôn trả tối đa 10)
K_UPSELL = 10    # Số lượng gợi ý Top K cho Upsale
MIN_CONF = 0.0   # BỎ ngưỡng tin cậy 3.5%, chỉ dùng MIN_CNT
MIN_CNT = 10     # Số lần xuất hiện tối thiểu

DATA_DIR = Path(__file__).parent / "data"
ITEMS_PATH = DATA_DIR / "items (2).parquet"
TRANS_PATH = DATA_DIR / "transactions-2025-12.parquet"


def load_data() -> tuple[pl.DataFrame, pl.DataFrame, dict[str, dict[str, int]]]:
    if not ITEMS_PATH.exists():
        raise SystemExit(f"Không tìm thấy file {ITEMS_PATH}")
    if not TRANS_PATH.exists():
        raise SystemExit(f"Không tìm thấy file {TRANS_PATH}")

    print("Đọc dữ liệu items & transactions bằng Polars (collect)...")
    it_l = pl.scan_parquet(str(ITEMS_PATH))
    tr_l = pl.scan_parquet(str(TRANS_PATH))

    it_df = it_l.collect()
    tr_df = tr_l.collect()

    items_info = (
        it_df.select(["item_id", "sale_status"])
        .group_by("item_id")
        .agg(pl.first("sale_status").alias("sale_status"))
        .to_dicts()
    )
    items_info = {d["item_id"]: {"sale_status": d["sale_status"]} for d in items_info}
    return it_df, tr_df, items_info


# =============================
# GIẢI PHÁP 1: FBT (PYTHON)
# =============================

def build_fbt(tr_df: pl.DataFrame, items_info: dict[str, dict[str, int]]) -> pl.DataFrame:
    print("Tạo baskets (customer_id, updated_date) -> list item_id...")
    baskets = (
        tr_df.group_by(["customer_id", "updated_date"]).agg(pl.col("item_id"))
    )
    baskets = baskets.filter(pl.col("item_id").list.len() > 1)

    co_occurrence: dict[str, Counter[str]] = defaultdict(Counter)
    item_basket_count: Counter[str] = Counter()

    for items_list in tqdm(baskets["item_id"].to_list(), desc="Processing baskets"):
        for item in items_list:
            item_basket_count[item] += 1
        for i, item_a in enumerate(items_list):
            for item_b in items_list[i + 1 :]:
                co_occurrence[item_a][item_b] += 1
                co_occurrence[item_b][item_a] += 1

    frequently_bought_together: dict[str, list[dict]] = {}

    for item_id in tqdm(list(co_occurrence.keys()), desc="Calculating confidence"):
        total_baskets = item_basket_count[item_id]
        recommendations: list[dict] = []
        for co_item_id, count in co_occurrence[item_id].items():
            confidence = count / total_baskets if total_baskets else 0.0
            # Bỏ điều kiện MIN_CONF, chỉ lọc theo MIN_CNT
            if count >= MIN_CNT:
                sale_status = items_info.get(co_item_id, {}).get("sale_status", 0)
                if sale_status == 1:
                    recommendations.append(
                        {
                            "a": item_id,
                            "b": co_item_id,
                            "cnt": int(count),
                            "conf": round(float(confidence), 4),
                            "t_a": int(total_baskets),
                            "sale_status": int(sale_status),
                        }
                    )
        recommendations.sort(key=lambda x: (x["conf"], x["cnt"]), reverse=True)
        frequently_bought_together[item_id] = recommendations[:K_FBT]

    fbt_master_list: list[dict] = []
    for item_a, recs in frequently_bought_together.items():
        for rec in recs:
            fbt_master_list.append(rec)

    if not fbt_master_list:
        return pl.DataFrame(
            {
                "a": pl.Series(dtype=pl.String),
                "b": pl.Series(dtype=pl.String),
                "cnt": pl.Series(dtype=pl.UInt32),
                "conf": pl.Series(dtype=pl.Float64),
                "t_a": pl.Series(dtype=pl.UInt32),
                "sale_status": pl.Series(dtype=pl.Int32),
            }
        )

    return pl.DataFrame(fbt_master_list)


# =============================
# GIẢI PHÁP 2: SIMILAR PRODUCTS
# =============================

def get_similar_products(df: pl.DataFrame, t_id: str, k: int = K_RECS) -> Optional[pl.DataFrame]:
    t_row = df.filter(pl.col("item_id") == t_id)
    if t_row.height == 0:
        return None
    t = t_row.to_dicts()[0]

    res = (
        df.filter(pl.col("item_id") != t_id)
        .with_columns(
            [
                pl.when(pl.col("category_l3") == t["category_l3"])
                .then(10)
                .when(pl.col("category_l2") == t["category_l2"])
                .then(7)
                .when(pl.col("category_l1") == t["category_l1"])
                .then(5)
                .otherwise(0)
                .alias("c_s"),
                ((pl.col("price") - t["price"]).abs() / t["price"]).alias("p_diff"),
            ]
        )
        .with_columns(
            [
                pl.when(pl.col("p_diff") <= 0.2)
                .then(5)
                .when(pl.col("p_diff") <= 0.5)
                .then(3)
                .when(pl.col("p_diff") <= 1.0)
                .then(2)
                .otherwise(0)
                .alias("p_s"),
                pl.when(pl.col("category_l3") == t["category_l3"])
                .then(pl.lit("L3"))
                .when(pl.col("category_l2") == t["category_l2"])
                .then(pl.lit("L2"))
                .when(pl.col("category_l1") == t["category_l1"])
                .then(pl.lit("L1"))
                .otherwise(pl.lit("None"))
                .alias("same_cat"),
            ]
        )
        .with_columns(
            [
                ((pl.col("c_s") + pl.col("p_s")) / 15.0).alias("sc"),
                pl.lit(t["price"]).alias("p_orig"),
            ]
        )
        .filter((pl.col("sc") > 0) & (pl.col("sale_status") == 1))
        .sort("sc", descending=True)
        .head(k)
        .select(
            [
                pl.col("item_id"),
                pl.col("sc").round(4).alias("similarity_score"),
                pl.col("same_cat").alias("same_category"),
                pl.col("p_orig").alias("price_original"),
                pl.col("price").alias("price_similar"),
                pl.col("p_diff").round(4).alias("price_diff_percent"),
            ]
        )
    )
    return res


# =============================
# GIẢI PHÁP 3: UPSELL
# =============================

def build_popularity(tr_df: pl.DataFrame) -> pl.DataFrame:
    return tr_df.group_by("item_id").agg(pl.len().alias("purchase_count"))


def get_upsell_products(
    items_df: pl.DataFrame, popularity_df: pl.DataFrame, target_item_id: str, k: int = K_UPSELL
) -> Optional[pl.DataFrame]:
    items_active = items_df.filter(pl.col("sale_status") == 1)
    target_row = items_active.filter(pl.col("item_id") == target_item_id)

    if target_row.height == 0:
        return None

    target = target_row.row(0, named=True)
    target_price = float(target.get("price") or 0)
    if target_price <= 0:
        return None

    df = (
        items_active.join(popularity_df, on="item_id", how="left")
        .with_columns(pl.col("purchase_count").fill_null(0))
    )

    result = (
        df.filter(
            (pl.col("item_id") != target_item_id)
            & (pl.col("price") > target_price)
            & (pl.col("price") <= target_price * 2)
        )
        .with_columns(
            [
                pl.when(pl.col("category_l3") == target["category_l3"])
                .then(1.0)
                .when(pl.col("category_l2") == target["category_l2"])
                .then(0.7)
                .when(pl.col("category_l1") == target["category_l1"])
                .then(0.5)
                .otherwise(0.0)
                .alias("category_score"),
                ((pl.col("price") - target_price) / target_price).alias("price_score"),
                pl.col("purchase_count").log1p().alias("popularity_score"),
            ]
        )
        .with_columns(
            (
                0.5 * pl.col("category_score")
                + 0.3 * pl.col("price_score")
                + 0.2 * pl.col("popularity_score")
            ).alias("upsell_score")
        )
        .sort("upsell_score", descending=True)
        .head(k)
        .select(
            [
                "item_id",
                "price",
                pl.col("upsell_score").round(4),
                pl.col("category_score").round(4),
                pl.col("price_score").round(4),
                pl.col("popularity_score").round(4),
                "purchase_count",
            ]
        )
    )

    return result


# =============================
# TRUY VẤN KẾT QUẢ (PYTHON CLI)
# =============================

def query_all(
    target_id: str,
    it_df: pl.DataFrame,
    fbt_master: pl.DataFrame,
    popularity: pl.DataFrame,
) -> None:
    # FBT
    fbt_res = (
        fbt_master.filter(pl.col("a") == target_id)
        .select(
            [
                pl.col("b").alias("item_id"),
                "cnt",
                pl.col("conf").round(4).alias("confidence"),
                "t_a",
            ]
        )
        .rename({"t_a": "total_baskets"})
        .head(10)
    )

    # SIM
    sim_res = get_similar_products(it_df, target_id, K_RECS)
    # UPSELL
    upsell_res = get_upsell_products(it_df, popularity, target_id, K_UPSELL)

    print("\n" + "=" * 90)
    print(f"TRUY VẤN HỆ THỐNG GỢI Ý CHO ID: {target_id}")
    print("=" * 90)

    with pl.Config(tbl_cols=-1, fmt_str_lengths=80):
        print("\n[PHƯƠNG PHÁP 1] FREQUENTLY BOUGHT TOGETHER (FBT):")
        if fbt_res.height > 0:
            print(fbt_res)
        else:
            print("Không có dữ liệu mua cùng.")

        print("\n[PHƯƠNG PHÁP 2] SIMILAR PRODUCTS (SIM):")
        if sim_res is not None and sim_res.height > 0:
            print(sim_res)
        else:
            print("Không tìm thấy sản phẩm tương tự.")

        print("\n[PHƯƠNG PHÁP 3] UPSELL (CATEGORY + PRICE + POPULARITY):")
        if upsell_res is not None and upsell_res.height > 0:
            print(upsell_res)
        else:
            print("Không tìm thấy sản phẩm upsale phù hợp.")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Demo FBT + SIM + UPSELL giống Colab bằng Python")
    parser.add_argument("item_id", nargs="?", default="0502040340038", help="item_id cần truy vấn")
    args = parser.parse_args()

    it_df, tr_df, items_info = load_data()
    it_df = it_df.with_columns(pl.col("price").cast(pl.Float64, strict=False))
    fbt_master = build_fbt(tr_df, items_info)
    popularity = build_popularity(tr_df)
    query_all(args.item_id, it_df, fbt_master, popularity)


if __name__ == "__main__":
    main()

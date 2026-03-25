from collections import defaultdict, Counter
from pathlib import Path
import json

import polars as pl
from tqdm import tqdm

K_FBT = 10
MIN_CONF = 0.0   # Bỏ ngưỡng 3.5%, chỉ lọc theo MIN_CNT
MIN_CNT = 10

DATA_DIR = Path(__file__).parent / "data"
ITEMS_PATH = DATA_DIR / "items (2).parquet"
TRANS_PATH = DATA_DIR / "transactions-2025-12.parquet"
OUTPUT_PATH = DATA_DIR / "fbt_master.json"


def main():
    if not ITEMS_PATH.exists():
        raise SystemExit(f"Không tìm thấy file {ITEMS_PATH}")
    if not TRANS_PATH.exists():
        raise SystemExit(f"Không tìm thấy file {TRANS_PATH}")

    print("Đọc dữ liệu items & transactions bằng Polars...")
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

    print("Tạo baskets (customer_id, updated_date) -> list item_id...")
    baskets = (
        tr_df.group_by(["customer_id", "updated_date"]).agg(pl.col("item_id"))
    )
    baskets = baskets.filter(pl.col("item_id").list.len() > 1)

    co_occurrence = defaultdict(Counter)
    item_basket_count = Counter()

    for items_list in tqdm(baskets["item_id"].to_list(), desc="Processing baskets"):
        for item in items_list:
            item_basket_count[item] += 1
        for i, item_a in enumerate(items_list):
            for item_b in items_list[i + 1 :]:
                co_occurrence[item_a][item_b] += 1
                co_occurrence[item_b][item_a] += 1

    frequently_bought_together = {}

    for item_id in tqdm(list(co_occurrence.keys()), desc="Calculating confidence"):
        total_baskets = item_basket_count[item_id]
        recs = []
        for co_item_id, count in co_occurrence[item_id].items():
            confidence = count / total_baskets if total_baskets else 0.0
            # Bỏ điều kiện MIN_CONF, chỉ giữ theo số lần xuất hiện tối thiểu
            if count >= MIN_CNT:
                sale_status = items_info.get(co_item_id, {}).get("sale_status", 0)
                if sale_status == 1:
                    recs.append(
                        {
                            "a": item_id,
                            "b": co_item_id,
                            "cnt": int(count),
                            "conf": round(float(confidence), 4),
                            "t_a": int(total_baskets),
                            "sale_status": int(sale_status),
                        }
                    )
        recs.sort(key=lambda x: (x["conf"], x["cnt"]), reverse=True)
        frequently_bought_together[item_id] = recs[:K_FBT]

    fbt_master_list = []
    for item_a, recs in frequently_bought_together.items():
        for rec in recs:
            fbt_master_list.append(rec)

    print(f"Ghi {len(fbt_master_list)} bản ghi FBT vào {OUTPUT_PATH}...")
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(fbt_master_list, f, ensure_ascii=False)

    print("Hoàn tất build fbt_master.json")


if __name__ == "__main__":
    main()

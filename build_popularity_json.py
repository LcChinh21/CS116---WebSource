from pathlib import Path
import json

import polars as pl

DATA_DIR = Path(__file__).parent / "data"
TRANS_PATH = DATA_DIR / "transactions-2025-12.parquet"
OUTPUT_PATH = DATA_DIR / "popularity.json"


def main() -> None:
    if not TRANS_PATH.exists():
        raise SystemExit(f"Khong tim thay file {TRANS_PATH}")

    print("Dang tinh purchase_count tu transactions...")
    popularity = (
        pl.scan_parquet(str(TRANS_PATH))
        .group_by("item_id")
        .agg(pl.len().alias("purchase_count"))
        .collect()
        .sort("purchase_count", descending=True)
    )

    payload = popularity.to_dicts()
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    print(f"Da ghi {len(payload)} ban ghi vao {OUTPUT_PATH}")


if __name__ == "__main__":
    main()

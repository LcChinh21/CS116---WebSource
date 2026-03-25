import argparse
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).parent / "data"
ITEMS_FILE = DATA_DIR / "items (2).parquet"
OUTPUT_FILE = DATA_DIR / "products.json"


def inspect():
    if not ITEMS_FILE.exists():
        print(f"Không tìm thấy file: {ITEMS_FILE}")
        return
    df = pd.read_parquet(ITEMS_FILE)
    print("=== Cột trong items.parquet ===")
    print(df.dtypes)
    print("\n=== 5 dòng đầu ===")
    print(df.head())


def convert():
    if not ITEMS_FILE.exists():
        print(f"Không tìm thấy file: {ITEMS_FILE}")
        return

    df = pd.read_parquet(ITEMS_FILE)

    # Mapping cột thực tế trong items.parquet sang schema product của web.
    # Schema thực tế (inspect):
    # item_id (str), price (object), category_l1, category_l2, category_l3,
    # category, brand, manufacturer, sale_status, size (nếu có)

    col_map = {
        "item_id": "id",          # mã sản phẩm
        "category": "name",       # dùng tên category làm tên đơn giản
        "price": "price",         # giá
        "size": "size",           # size (đặc biệt dùng cho Tã)
        # các cột khác sẽ được dùng ghép thành description
    }

    # Giữ lại các cột tồn tại trong df
    existing = {src: dst for src, dst in col_map.items() if src in df.columns}

    df2 = df[list(existing.keys())].rename(columns=existing)

    # Thêm các field bắt buộc nếu thiếu
    if "id" not in df2.columns:
        df2["id"] = range(1, len(df2) + 1)

    if "name" not in df2.columns:
        df2["name"] = "(no name)"

    # Dùng category_l1 làm category chính nếu có, nếu không thì dùng category
    if "category" not in df2.columns:
        if "category_l1" in df.columns:
            df2["category"] = df["category_l1"].fillna("Unknown")
        else:
            df2["category"] = "Unknown"

    if "price" not in df2.columns:
        df2["price"] = 0

    # rating không có trong dataset => đặt mặc định
    df2["rating"] = 0.0

    # Mang theo thông tin phân cấp category & sale_status để JS tối ưu theo sale_status
    if "category_l1" in df.columns:
        df2["category_l1"] = df["category_l1"].fillna("")
    if "category_l2" in df.columns:
        df2["category_l2"] = df["category_l2"].fillna("")
    if "category_l3" in df.columns:
        df2["category_l3"] = df["category_l3"].fillna("")

    if "sale_status" in df.columns:
        df2["sale_status"] = df["sale_status"].fillna(1).astype(int)
    else:
        df2["sale_status"] = 1

    # Ghép mô tả đơn giản từ brand, manufacturer, category_l2, category_l3
    desc_parts = []
    if "brand" in df.columns:
        desc_parts.append("Brand: " + df["brand"].fillna("").astype(str))
    if "manufacturer" in df.columns:
        desc_parts.append(" | Manufacturer: " + df["manufacturer"].fillna("").astype(str))
    if "category_l2" in df.columns:
        desc_parts.append(" | Cat L2: " + df["category_l2"].fillna("").astype(str))
    if "category_l3" in df.columns:
        desc_parts.append(" | Cat L3: " + df["category_l3"].fillna("").astype(str))

    if desc_parts:
        # cộng chuỗi từng cột lại theo hàng
        df2["description"] = ""
        for part in desc_parts:
            df2["description"] = df2["description"] + part
    else:
        df2["description"] = ""

    # Thêm cột tags đơn giản từ category và brand
    tags = []
    if "category" in df2.columns:
        tags.append(df2["category"].fillna("").astype(str))
    if "brand" in df.columns:
        tags.append(df["brand"].fillna("").astype(str))

    if tags:
        # tạo list tags per row
        df2["tags"] = [list({t for t in row if t}) for row in zip(*tags)]
    else:
        df2["tags"] = [[] for _ in range(len(df2))]

    # Ghi ra JSON dạng list of objects
    OUTPUT_FILE.write_text(
        df2.to_json(orient="records", force_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Đã ghi {len(df2)} sản phẩm vào {OUTPUT_FILE}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["inspect", "convert"], nargs="?", default="inspect")
    args = parser.parse_args()

    if args.mode == "inspect":
        inspect()
    else:
        convert()


if __name__ == "__main__":
    main()

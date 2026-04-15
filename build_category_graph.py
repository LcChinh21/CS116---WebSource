from __future__ import annotations

import argparse
import json
import math
import shutil
import unicodedata
from pathlib import Path
from typing import Any

import polars as pl

DATA_DIR = Path(__file__).parent / "data"
DEFAULT_ITEMS_PATH = DATA_DIR / "items (2).parquet"
DEFAULT_TRANS_2024_PATH = DATA_DIR / "transactions-202411-to-202412.parquet"
DEFAULT_TRANS_2025_PATH = DATA_DIR / "transactions-2025-12.parquet"

# We normalize text to ASCII, then exclude category groups containing these tokens.
EXCLUDED_TOKENS = {"sua", "ta", "milk", "diaper"}


def normalize_ascii(text: str) -> str:
    text = text.strip().lower()
    text = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in text if not unicodedata.combining(ch))


def tokenize(text: str) -> list[str]:
    normalized = normalize_ascii(text)
    buff: list[str] = []
    token = []
    for ch in normalized:
        if ch.isalnum():
            token.append(ch)
        elif token:
            buff.append("".join(token))
            token = []
    if token:
        buff.append("".join(token))
    return buff


def is_excluded_category(category_l1: str | None, category_l2: str | None) -> bool:
    raw = f"{category_l1 or ''} {category_l2 or ''}"
    tokens = set(tokenize(raw))
    return bool(tokens.intersection(EXCLUDED_TOKENS))


def build_category_key(category_l1: str, category_l2: str) -> str:
    return f"{category_l1} | {category_l2}"


def load_items(items_path: Path) -> pl.DataFrame:
    if not items_path.exists():
        raise SystemExit(f"Khong tim thay file items: {items_path}")

    items = pl.read_parquet(items_path)
    required = {"item_id", "category_l1", "category_l2", "sale_status"}
    missing = required - set(items.columns)
    if missing:
        raise SystemExit(f"Items thieu cot bat buoc: {sorted(missing)}")

    items = (
        items.select(["item_id", "category_l1", "category_l2", "sale_status"])
        .with_columns(
            [
                pl.col("category_l1").cast(pl.String).fill_null("Unknown"),
                pl.col("category_l2").cast(pl.String).fill_null("Unknown"),
                pl.col("sale_status").cast(pl.Int64, strict=False).fill_null(0),
            ]
        )
        .with_columns(
            [
                pl.struct(["category_l1", "category_l2"])
                .map_elements(
                    lambda x: is_excluded_category(x["category_l1"], x["category_l2"]),
                    return_dtype=pl.Boolean,
                )
                .alias("is_excluded"),
                pl.struct(["category_l1", "category_l2"])
                .map_elements(
                    lambda x: build_category_key(x["category_l1"], x["category_l2"]),
                    return_dtype=pl.String,
                )
                .alias("category_key"),
            ]
        )
        .group_by("item_id")
        .agg(
            [
                pl.first("category_l1").alias("category_l1"),
                pl.first("category_l2").alias("category_l2"),
                pl.first("category_key").alias("category_key"),
                pl.max("sale_status").alias("sale_status"),
                pl.first("is_excluded").alias("is_excluded"),
            ]
        )
    )
    return items


def load_transactions(trans_2024_path: Path, trans_2025_path: Path) -> pl.DataFrame:
    if not trans_2024_path.exists():
        raise SystemExit(f"Khong tim thay transactions 2024: {trans_2024_path}")
    if not trans_2025_path.exists():
        raise SystemExit(f"Khong tim thay transactions 2025: {trans_2025_path}")

    tr24 = pl.read_parquet(trans_2024_path)
    tr25 = pl.read_parquet(trans_2025_path)

    required = {"customer_id", "item_id", "updated_date"}
    missing_24 = required - set(tr24.columns)
    missing_25 = required - set(tr25.columns)
    if missing_24:
        raise SystemExit(f"transactions 2024 thieu cot: {sorted(missing_24)}")
    if missing_25:
        raise SystemExit(f"transactions 2025 thieu cot: {sorted(missing_25)}")

    tr24 = tr24.select(["customer_id", "item_id", "updated_date"])
    tr25 = tr25.select(["customer_id", "item_id", "updated_date"])
    trans = pl.concat([tr24, tr25], how="vertical_relaxed")

    return trans.with_columns(
        [
            pl.col("customer_id").cast(pl.String),
            pl.col("item_id").cast(pl.String),
            pl.col("updated_date").cast(pl.String),
            pl.concat_str([pl.col("customer_id"), pl.col("updated_date")], separator="|").alias("basket_id"),
        ]
    ).select(["basket_id", "item_id"])


def build_edges(
    items_df: pl.DataFrame,
    trans_df: pl.DataFrame,
    min_cooccur: int,
    use_lift: bool,
    only_positive_lift: bool,
    max_baskets: int | None,
) -> tuple[pl.DataFrame, pl.DataFrame, int]:
    active_items = items_df.filter((pl.col("sale_status") == 1) & (~pl.col("is_excluded")))

    basket_categories = (
        trans_df.join(active_items.select(["item_id", "category_key"]), on="item_id", how="inner")
        .select(["basket_id", "category_key"])
        .unique()
    )

    if max_baskets and max_baskets > 0:
        sampled = basket_categories.select("basket_id").unique().head(max_baskets)
        basket_categories = basket_categories.join(sampled, on="basket_id", how="inner")

    basket_sizes = basket_categories.group_by("basket_id").agg(pl.len().alias("n_cat"))
    valid_baskets = basket_sizes.filter(pl.col("n_cat") > 1).select("basket_id")
    basket_categories = basket_categories.join(valid_baskets, on="basket_id", how="inner")

    total_baskets = valid_baskets.height
    if total_baskets == 0:
        return (
            pl.DataFrame(
                {
                    "source": pl.Series(dtype=pl.String),
                    "target": pl.Series(dtype=pl.String),
                    "count_ab": pl.Series(dtype=pl.Int64),
                    "count_a": pl.Series(dtype=pl.Int64),
                    "count_b": pl.Series(dtype=pl.Int64),
                    "p_b_given_a": pl.Series(dtype=pl.Float64),
                    "p_a_given_b": pl.Series(dtype=pl.Float64),
                    "lift": pl.Series(dtype=pl.Float64),
                    "weight": pl.Series(dtype=pl.Float64),
                }
            ),
            pl.DataFrame({"category_key": pl.Series(dtype=pl.String), "count_a": pl.Series(dtype=pl.Int64)}),
            0,
        )

    cat_counts = basket_categories.group_by("category_key").agg(pl.len().alias("count_a"))

    pair_counts = (
        basket_categories.join(basket_categories, on="basket_id", how="inner", suffix="_b")
        .filter(pl.col("category_key") < pl.col("category_key_b"))
        .group_by(["category_key", "category_key_b"])
        .agg(pl.len().alias("count_ab"))
        .filter(pl.col("count_ab") >= min_cooccur)
    )

    if pair_counts.height == 0:
        return (
            pl.DataFrame(
                {
                    "source": pl.Series(dtype=pl.String),
                    "target": pl.Series(dtype=pl.String),
                    "count_ab": pl.Series(dtype=pl.Int64),
                    "count_a": pl.Series(dtype=pl.Int64),
                    "count_b": pl.Series(dtype=pl.Int64),
                    "p_b_given_a": pl.Series(dtype=pl.Float64),
                    "p_a_given_b": pl.Series(dtype=pl.Float64),
                    "lift": pl.Series(dtype=pl.Float64),
                    "weight": pl.Series(dtype=pl.Float64),
                }
            ),
            cat_counts,
            total_baskets,
        )

    edges = (
        pair_counts.join(
            cat_counts.rename({"category_key": "category_key", "count_a": "count_a"}),
            on="category_key",
            how="left",
        )
        .join(
            cat_counts.rename({"category_key": "category_key_b", "count_a": "count_b"}),
            on="category_key_b",
            how="left",
        )
        .with_columns(
            [
                (pl.col("count_ab") / pl.col("count_a")).alias("p_b_given_a"),
                (pl.col("count_ab") / pl.col("count_b")).alias("p_a_given_b"),
                (
                    (pl.col("count_ab") * pl.lit(float(total_baskets)))
                    / (pl.col("count_a") * pl.col("count_b"))
                ).alias("lift"),
            ]
        )
        .with_columns(
            [
                (
                    pl.col("count_ab").cast(pl.Float64).log()
                    * (pl.col("p_b_given_a") + pl.col("p_a_given_b"))
                ).alias("weight_basic"),
                (
                    pl.col("count_ab").cast(pl.Float64).log()
                    * pl.when(pl.col("lift") > 0)
                    .then(pl.col("lift").log())
                    .otherwise(0.0)
                    * (pl.col("p_b_given_a") + pl.col("p_a_given_b"))
                ).alias("weight_lift"),
            ]
        )
    )

    if only_positive_lift:
        edges = edges.filter(pl.col("lift") > 1.0)

    edges = edges.with_columns(
        pl.when(pl.lit(use_lift)).then(pl.col("weight_lift")).otherwise(pl.col("weight_basic")).alias("weight")
    )

    edges = (
        edges.select(
            [
                pl.col("category_key").alias("source"),
                pl.col("category_key_b").alias("target"),
                "count_ab",
                "count_a",
                "count_b",
                pl.col("p_b_given_a").round(6),
                pl.col("p_a_given_b").round(6),
                pl.col("lift").round(6),
                pl.col("weight").round(6),
            ]
        )
        .filter(pl.col("weight").is_not_null())
        .sort("weight", descending=True)
    )

    return edges, cat_counts, total_baskets


def build_recommendations(edges: pl.DataFrame, topk: int) -> dict[str, list[dict[str, Any]]]:
    if edges.height == 0:
        return {}

    directed = edges.select(
        [
            pl.col("source").alias("src"),
            pl.col("target").alias("dst"),
            "weight",
            "count_ab",
            "lift",
            "p_b_given_a",
        ]
    ).sort(["src", "weight"], descending=[False, True])

    output: dict[str, list[dict[str, Any]]] = {}
    for src, chunk in directed.partition_by("src", as_dict=True).items():
        rows = chunk.head(topk).to_dicts()
        output[src[0] if isinstance(src, tuple) else src] = rows

    return output


def limit_outgoing_edges(edges: pl.DataFrame, max_outgoing: int) -> pl.DataFrame:
    if edges.height == 0:
        return edges
    if max_outgoing <= 0:
        return edges

    forward = edges.select(
        [
            "source",
            "target",
            "count_ab",
            "count_a",
            "count_b",
            "p_b_given_a",
            "p_a_given_b",
            "lift",
            "weight",
        ]
    )
    backward = edges.select(
        [
            pl.col("target").alias("source"),
            pl.col("source").alias("target"),
            "count_ab",
            pl.col("count_b").alias("count_a"),
            pl.col("count_a").alias("count_b"),
            pl.col("p_a_given_b").alias("p_b_given_a"),
            pl.col("p_b_given_a").alias("p_a_given_b"),
            "lift",
            "weight",
        ]
    )

    directed = pl.concat([forward, backward], how="vertical_relaxed")

    limited = (
        directed.sort(["source", "weight", "count_ab", "target"], descending=[False, True, True, False])
        .group_by("source", maintain_order=True)
        .head(max_outgoing)
        .sort(["weight", "count_ab"], descending=[True, True])
    )

    return limited


def render_pyvis_graph(edges: pl.DataFrame, cat_counts: pl.DataFrame, html_path: Path, max_edges: int) -> None:
    try:
        from pyvis.network import Network
    except ImportError as exc:
        raise SystemExit("Thieu thu vien pyvis. Cai dat bang lenh: pip install pyvis") from exc

    html_path.parent.mkdir(parents=True, exist_ok=True)

    graph = Network(height="900px", width="100%", bgcolor="#0f172a", font_color="#e2e8f0", notebook=False)
    graph.barnes_hut(gravity=-20000, central_gravity=0.2, spring_length=140, spring_strength=0.02, damping=0.09)

    count_map = {r["category_key"]: int(r["count_a"]) for r in cat_counts.to_dicts()}
    for cat, cnt in count_map.items():
        size = 10 + (math.log1p(cnt) * 2.5)
        graph.add_node(cat, label=cat, title=f"{cat}<br>basket_count={cnt}", size=size)

    edge_rows = edges.head(max_edges).to_dicts()
    for r in edge_rows:
        width = 1.0 + (max(float(r["weight"]), 0.0) * 2.0)
        graph.add_edge(
            r["source"],
            r["target"],
            value=max(float(r["weight"]), 0.0),
            width=width,
            title=(
                f"count_ab={r['count_ab']}<br>"
                f"P(B|A)={r['p_b_given_a']}<br>"
                f"P(A|B)={r['p_a_given_b']}<br>"
                f"lift={r['lift']}<br>"
                f"weight={r['weight']}"
            ),
            color="#22d3ee",
        )

    graph.write_html(str(html_path), open_browser=False, notebook=False)

    # PyVis writes local assets to ./lib. Mirror them under data/lib so data/category_graph.html
    # can resolve "lib/..." when embedded from the main page.
    root_lib = Path.cwd() / "lib"
    target_lib = html_path.parent / "lib"
    if root_lib.exists():
        if target_lib.exists():
            shutil.rmtree(target_lib)
        shutil.copytree(root_lib, target_lib)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Xay dung do thi lien ket category_l1 + category_l2 de goi y chen san pham khac chung loai."
        )
    )
    parser.add_argument("--items", type=Path, default=DEFAULT_ITEMS_PATH)
    parser.add_argument("--trans-2024", type=Path, default=DEFAULT_TRANS_2024_PATH)
    parser.add_argument("--trans-2025", type=Path, default=DEFAULT_TRANS_2025_PATH)
    parser.add_argument("--min-cooccur", type=int, default=50, help="Nguong so basket co dong xuat hien toi thieu")
    parser.add_argument(
        "--formula",
        choices=["basic", "lift"],
        default="lift",
        help="basic: log(count)*[P(B|A)+P(A|B)] | lift: them thanh phan log(lift)",
    )
    parser.add_argument(
        "--allow-non-positive-lift",
        action="store_true",
        help="Neu bat, giu ca canh co lift <= 1.0",
    )
    parser.add_argument("--topk", type=int, default=10, help="Top K category de goi y cho moi category")
    parser.add_argument(
        "--max-outgoing",
        type=int,
        default=2,
        help="So canh toi da moi node duoc noi ra (node van co the nhan nhieu canh di vao)",
    )
    parser.add_argument("--max-baskets", type=int, default=None, help="Chi dung de test nhanh, gioi han so basket")
    parser.add_argument("--max-edges-visual", type=int, default=400, help="So canh toi da khi ve PyVis")
    parser.add_argument("--out-edges", type=Path, default=DATA_DIR / "category_graph_edges.parquet")
    parser.add_argument("--out-recs", type=Path, default=DATA_DIR / "category_graph_recommendations.json")
    parser.add_argument("--out-html", type=Path, default=DATA_DIR / "category_graph.html")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    use_lift = args.formula == "lift"

    print("[1/4] Dang doc items va transactions 2024+2025...")
    items_df = load_items(args.items)
    trans_df = load_transactions(args.trans_2024, args.trans_2025)

    print("[2/4] Dang tinh canh do thi category...")
    edges_raw, cat_counts, total_baskets = build_edges(
        items_df=items_df,
        trans_df=trans_df,
        min_cooccur=args.min_cooccur,
        use_lift=use_lift,
        only_positive_lift=not args.allow_non_positive_lift,
        max_baskets=args.max_baskets,
    )
    edges = limit_outgoing_edges(edges_raw, args.max_outgoing)

    args.out_edges.parent.mkdir(parents=True, exist_ok=True)
    edges.write_parquet(args.out_edges)

    print("[3/4] Dang tao top goi y category chen vao...")
    recs = build_recommendations(edges, args.topk)
    with args.out_recs.open("w", encoding="utf-8") as f:
        json.dump(recs, f, ensure_ascii=False, indent=2)

    print("[4/4] Dang ve do thi PyVis...")
    render_pyvis_graph(edges, cat_counts, args.out_html, args.max_edges_visual)

    print("\nHoan tat.")
    print(f"Tong so basket hop le: {total_baskets}")
    print(f"So canh truoc gioi han outgoing: {edges_raw.height}")
    print(f"So canh sau loc: {edges.height}")
    print(f"Edges: {args.out_edges}")
    print(f"Recommendations: {args.out_recs}")
    print(f"Graph HTML: {args.out_html}")


if __name__ == "__main__":
    main()

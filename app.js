// ===== Data loading =====
let products = [];
let currentAlgorithm = "fbt"; // "fbt" | "sim" | "upsale"
let currentProductId = null;
let fbtRows = [];
let fbtIndex = new Map();
let popularityRows = [];
let popularityIndex = new Map();

async function loadProducts() {
    const listEl = document.getElementById("product-list");
    try {
        const [resProducts, resFbt, resPopularity] = await Promise.all([
            fetch("data/products.json"),
            fetch("data/fbt_master.json").catch(() => null),
            fetch("data/popularity.json").catch(() => null),
        ]);

        if (!resProducts.ok)
            throw new Error("Không đọc được file data/products.json");

        const data = await resProducts.json();
        products = data;

        if (resFbt && resFbt.ok) {
            fbtRows = await resFbt.json();
            buildFbtIndex();
        }

        if (resPopularity && resPopularity.ok) {
            popularityRows = await resPopularity.json();
            buildPopularityIndex();
        } else {
            // Fallback: xấp xỉ purchase_count từ dữ liệu FBT nếu chưa có popularity.json
            buildPopularityFallbackFromFbt();
        }

        renderProductList();
    } catch (err) {
        console.error(err);
        listEl.innerHTML = `<div class="error">Lỗi load dữ liệu: ${err.message}</div>`;
    }
}

// ===== Rendering =====

function formatPriceVND(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "Giá: đang cập nhật";
    return n.toLocaleString("vi-VN", { style: "currency", currency: "VND" });
}

function formatRating(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "Rating: -";
    return `Rating: ${n.toFixed(1)}★`;
}

function getInitials(name) {
    if (!name) return "?";
    const parts = String(name)
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (!parts.length) return "?";
    const first = parts[0][0] || "";
    const second = parts[1]?.[0] || parts[0][1] || "";
    return (first + second).toUpperCase();
}

function stringHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (h * 31 + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

function getSizeRank(size) {
    if (!size) return null;
    const s = String(size).trim().toUpperCase();
    const map = {
        NB: 0,
        S: 1,
        M: 2,
        L: 3,
        XL: 4,
        XXL: 5,
        XXXL: 6,
    };
    return Object.prototype.hasOwnProperty.call(map, s) ? map[s] : null;
}

function dedupeRecommendations(rows, k = 10) {
    const seen = new Set();
    const result = [];

    for (const row of rows) {
        const id = String(row?.product?.id ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        result.push(row);
        if (result.length >= k) break;
    }

    return result;
}

function buildFbtIndex() {
    fbtIndex = new Map();
    if (!Array.isArray(fbtRows) || fbtRows.length === 0) return;

    const byId = new Map(products.map((p) => [String(p.id), p]));

    for (const row of fbtRows) {
        const a = String(row.a);
        const b = String(row.b);
        const product = byId.get(b);
        if (!product) continue;

        const list = fbtIndex.get(a) || [];
        list.push({
            product,
            cnt: row.cnt,
            conf: row.conf,
            totalBaskets: row.t_a,
        });
        fbtIndex.set(a, list);
    }

    for (const [key, list] of fbtIndex.entries()) {
        list.sort((x, y) => {
            if (y.conf !== x.conf) return y.conf - x.conf;
            return y.cnt - x.cnt;
        });
        fbtIndex.set(key, list);
    }
}

function buildPopularityIndex() {
    popularityIndex = new Map();
    if (!Array.isArray(popularityRows) || popularityRows.length === 0) return;

    for (const row of popularityRows) {
        const key = String(row.item_id ?? row.id ?? "");
        if (!key) continue;
        const cnt = Number(row.purchase_count ?? 0);
        popularityIndex.set(key, Number.isFinite(cnt) ? cnt : 0);
    }
}

function buildPopularityFallbackFromFbt() {
    popularityIndex = new Map();
    if (!Array.isArray(fbtRows) || fbtRows.length === 0) return;

    for (const row of fbtRows) {
        const key = String(row.a ?? "");
        if (!key) continue;
        const tA = Number(row.t_a ?? 0);
        if (!Number.isFinite(tA)) continue;
        const prev = popularityIndex.get(key) || 0;
        if (tA > prev) popularityIndex.set(key, tA);
    }
}

function getThumbStyle(product) {
    const key = product.category || product.name || String(product.id || "");
    const h = stringHash(key) % 360;
    const h2 = (h + 40) % 360;
    return `background: radial-gradient(circle at 30% 20%, hsl(${h}, 80%, 70%), hsl(${h2}, 80%, 35%));`;
}

function renderProductList() {
    const listEl = document.getElementById("product-list");
    listEl.innerHTML = "";
    const visibleProducts = products.filter(
        (p) => p.sale_status === undefined || p.sale_status === 1
    );

    visibleProducts.forEach((p) => {
        const hasFbt = fbtIndex.size > 0 && fbtIndex.has(String(p.id));
        const card = document.createElement("div");
        card.className = "product-card" + (p.id === currentProductId ? " active" : "");
        card.innerHTML = `
            <div class="product-card-inner">
                <div class="product-thumb" style="${getThumbStyle(p)}">
                    <span>${getInitials(p.name)}</span>
                </div>
                <div class="product-card-body">
                    <div class="product-card-title">${p.name}</div>
                    <div class="product-card-meta-line">
                        <span class="badge">${p.category}</span>
                        <span class="product-price">${formatPriceVND(p.price)}</span>
                    </div>
                    <div class="product-card-submeta">
                        ID: ${p.id} · ${formatRating(p.rating)}${
                            hasFbt ? ' · <span class="pill-fbt">Có dữ liệu FBT</span>' : ""
                        }
                    </div>
                </div>
            </div>
        `;
        card.addEventListener("click", () => {
            currentProductId = p.id;
            renderProductList();
            renderDetailAndSimilar();
        });
        listEl.appendChild(card);
    });
}

function renderDetailAndSimilar() {
    const detailEl = document.getElementById("product-detail");
    const similarEl = document.getElementById("similar-items");

    const product = products.find((p) => p.id === currentProductId);
    if (!product) {
        detailEl.classList.add("empty-state");
        detailEl.textContent = "Chọn một sản phẩm để xem chi tiết.";
        similarEl.innerHTML = "";
        return;
    }

    detailEl.classList.remove("empty-state");
    detailEl.innerHTML = `
        <div class="detail-header">
            <div class="detail-thumb" style="${getThumbStyle(product)}">
                <span>${getInitials(product.name)}</span>
            </div>
            <div class="detail-main">
                <h3 class="product-detail-title">${product.name}</h3>
                <div class="product-detail-meta">
                    <span class="badge">${product.category}</span>
                    <span class="product-price">${formatPriceVND(product.price)}</span>
                    <span class="product-rating">${formatRating(product.rating)}</span>
                </div>
                <div class="product-detail-id">Mã sản phẩm: ${product.id}</div>
            </div>
        </div>
        <div class="product-detail-desc">${product.description || "(Không có mô tả)"}</div>
    `;

    let recommender = recommendByFbt;
    if (currentAlgorithm === "sim") {
        recommender = recommendBySim;
    } else if (currentAlgorithm === "upsale") {
        recommender = recommendByUpsale;
    }
    const similar = recommender(products, product, 10);

    similarEl.innerHTML = "";
    if (!similar.length) {
        if (currentAlgorithm === "fbt") {
            similarEl.textContent =
                "Không có sản phẩm mua cùng (FBT) cho mã này (dữ liệu ít). Hãy thử chọn sản phẩm khác hoặc chuyển sang SIM.";
        } else if (currentAlgorithm === "upsale") {
            similarEl.textContent =
                "Không tìm thấy sản phẩm upsale phù hợp (cao giá hơn trong cùng nhóm ngành).";
        } else {
            similarEl.textContent = "Không tìm thấy sản phẩm tương tự theo SIM.";
        }
        return;
    }

    similar.forEach((item) => {
        let scoreLabel;
        if (currentAlgorithm === "upsale") {
            if (typeof item.upsaleScore === "number") {
                scoreLabel = `Upsale: <span class="similar-score">${item.upsaleScore.toFixed(3)}</span> · Co-buy: <span class="similar-score">${item.coBuy}</span> · Final: <span class="similar-score">${item.score.toFixed(3)}</span>`;
            } else if (typeof item.coBuy === "number") {
                scoreLabel = `Co-buy: <span class="similar-score">${item.coBuy}</span> · Score: <span class="similar-score">${item.score.toFixed(3)}</span>`;
            } else {
                scoreLabel = `Score: <span class="similar-score">${item.score.toFixed(3)}</span>`;
            }
        } else {
            scoreLabel = `Score: <span class="similar-score">${item.score.toFixed(3)}</span>`;
        }

        const card = document.createElement("div");
        card.className = "similar-card";
        card.innerHTML = `
            <div class="similar-card-inner">
                <div class="similar-thumb" style="${getThumbStyle(item.product)}">
                    <span>${getInitials(item.product.name)}</span>
                </div>
                <div class="similar-main">
                    <div class="similar-card-title">${item.product.name}</div>
                    <div class="product-card-meta">
                        <span class="badge">${item.product.category}</span>
                        <span class="product-price">${formatPriceVND(item.product.price)}</span>
                    </div>
                    <div class="similar-score-line">${scoreLabel}</div>
                </div>
            </div>
        `;
        card.addEventListener("click", () => {
            currentProductId = item.product.id;
            renderProductList();
            renderDetailAndSimilar();
        });
        similarEl.appendChild(card);
    });
}

// ===== Algorithm 1: tag & category based =====

// Giải pháp 1 (FBT) sử dụng dữ liệu đã tính sẵn từ Python (fbt_master.json)
// Luôn cố gắng trả tối đa 10 sản phẩm gợi ý
function recommendByFbt(allProducts, target, k = 10) {
    const key = String(target.id);
    const list = fbtIndex.get(key) || [];
    const recs = list.map((r) => ({ product: r.product, score: r.conf }));
    return dedupeRecommendations(recs, k);
}

// ===== Algorithm 2: feature vector similarity =====

// Giải pháp 2 (SIM) mô phỏng logic get_similar_products trong Colab
function recommendBySim(allProducts, target, k = 6) {
    const tCat1 = target.category_l1 || target.category || null;
    const tCat2 = target.category_l2 || null;
    const tCat3 = target.category_l3 || null;
    const tPrice = Number(target.price) || 0;

    const scored = [];
    for (const p of allProducts) {
        if (p.id === target.id) continue;
        if (p.sale_status !== undefined && p.sale_status !== 1) continue;

        const cat1 = p.category_l1 || p.category || null;
        const cat2 = p.category_l2 || null;
        const cat3 = p.category_l3 || null;

        let c_s = 0;
        let sameCat = "None";
        if (tCat3 && cat3 && tCat3 === cat3) {
            c_s = 10;
            sameCat = "L3";
        } else if (tCat2 && cat2 && tCat2 === cat2) {
            c_s = 7;
            sameCat = "L2";
        } else if (tCat1 && cat1 && tCat1 === cat1) {
            c_s = 5;
            sameCat = "L1";
        }

        const price = Number(p.price) || 0;
        let p_diff = 1e9;
        if (tPrice > 0 && price > 0) {
            p_diff = Math.abs(price - tPrice) / tPrice;
        }

        let p_s = 0;
        if (p_diff <= 0.2) p_s = 5;
        else if (p_diff <= 0.5) p_s = 3;
        else if (p_diff <= 1.0) p_s = 2;

        const sc = (c_s + p_s) / 15.0;
        if (sc <= 0) continue;

        scored.push({ product: p, score: sc, sameCategory: sameCat, priceDiff: p_diff });
    }

    scored.sort((a, b) => b.score - a.score);
    return dedupeRecommendations(scored, k);
}

// ===== Algorithm 3: upsale recommendation =====

// Giải pháp 3 (UPSALE): ưu tiên sản phẩm Tã có size lớn hơn dựa trên co-buy
function recommendByUpsale(allProducts, target, k = 6) {
    const key = String(target.id);
    const list = fbtIndex.get(key) || [];
    if (!list.length) return [];

    const isDiaperTarget =
        (target.category_l1 && target.category_l1.includes("Tã")) ||
        (target.category && target.category.includes("Tã"));

    const tCat2 = target.category_l2 || null;
    const tCat3 = target.category_l3 || null;

    const tRank = isDiaperTarget ? getSizeRank(target.size) : null;

    const scored = [];
    for (const row of list) {
        const p = row.product;
        if (!p) continue;
        if (p.sale_status !== undefined && p.sale_status !== 1) continue;

        const baseCoBuy = Number(row.cnt ?? 0) || 0;
        if (baseCoBuy <= 0) continue;

        const cat2 = p.category_l2 || null;
        const cat3 = p.category_l3 || null;
        if (tCat3 && cat3 && tCat3 !== cat3 && !(tCat2 && cat2 && tCat2 === cat2)) {
            // target có L3: yêu cầu L3 trùng, nếu không thì cho phép fallback L2 trùng
            continue;
        }
        if (!tCat3 && tCat2 && cat2 && tCat2 !== cat2) {
            // chỉ có L2: yêu cầu L2 trùng
            continue;
        }

        let score = baseCoBuy;
        let upsaleScore = null;
        let sizeDiff = null;

        const isDiaperCandidate =
            (p.category_l1 && p.category_l1.includes("Tã")) ||
            (p.category && p.category.includes("Tã"));

        if (isDiaperTarget && isDiaperCandidate && tRank !== null) {
            const cRank = getSizeRank(p.size);
            if (cRank !== null) {
                const diff = cRank - tRank;
                sizeDiff = diff;
                if (diff > 0) {
                    upsaleScore = diff / 6.0;
                    score = baseCoBuy * upsaleScore;
                }
            }
        } else {
            // không phải Tã: score_upsale = 1
            upsaleScore = 1.0;
        }

        scored.push({
            product: p,
            score,
            coBuy: baseCoBuy,
            upsaleScore,
            sizeDiff,
        });
    }

    scored.sort((a, b) => b.score - a.score);
    return dedupeRecommendations(scored, k);
}

// ===== Code viewer =====

function showCode(fn) {
    const codeEl = document.getElementById("code-view");
    const code = fn.toString();
    // Gán text trước để tránh XSS
    codeEl.textContent = code;
    // Thêm class language để highlight.js nhận diện
    codeEl.classList.remove("language-python");
    codeEl.classList.add("language-javascript");
    // Gọi highlight.js nếu đã load
    if (window.hljs && typeof window.hljs.highlightElement === "function") {
        window.hljs.highlightElement(codeEl);
    }
}

async function showPythonSource() {
    const codeEl = document.getElementById("code-view");
    try {
        const res = await fetch("recs_python.py");
        if (!res.ok) throw new Error("Không đọc được recs_python.py");
        const text = await res.text();
        codeEl.textContent = text;
        codeEl.classList.remove("language-javascript");
        codeEl.classList.add("language-python");
        if (window.hljs && typeof window.hljs.highlightElement === "function") {
            window.hljs.highlightElement(codeEl);
        }
    } catch (err) {
        console.error(err);
        codeEl.textContent = `// Lỗi load recs_python.py: ${err.message}`;
    }
}

// ===== Event wiring =====

function setupEvents() {
    document
        .querySelectorAll('input[name="algo"]')
        .forEach((radio) => {
            radio.addEventListener("change", (e) => {
                currentAlgorithm = e.target.value;
                if (currentProductId != null) {
                    renderDetailAndSimilar();
                }
            });
        });

    const btnPython = document.getElementById("btn-code-python");
    if (btnPython) {
        btnPython.addEventListener("click", () => {
            showPythonSource();
        });
    }

    const layout = document.querySelector(".layout");
    const codePanel = document.getElementById("code-panel");
    const toggleBtn = document.getElementById("btn-toggle-code");
    if (layout && codePanel && toggleBtn) {
        // Mặc định: ẩn code panel (class layout-code-hidden đã có trong HTML)
        toggleBtn.textContent = "Hiện source code";

        toggleBtn.addEventListener("click", () => {
            const isHidden = layout.classList.toggle("layout-code-hidden");
            toggleBtn.textContent = isHidden ? "Hiện source code" : "Ẩn source code";
        });
    }
}

window.addEventListener("DOMContentLoaded", () => {
    setupEvents();
    loadProducts();
});

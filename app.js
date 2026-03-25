// ===== Data loading =====
let products = [];
let currentAlgorithm = "fbt"; // "fbt" | "sim" | "upsale"
let currentProductId = null;
let fbtRows = [];
let fbtIndex = new Map();
let popularityRows = [];
let popularityIndex = new Map();
let cart = [];

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
    return `background: linear-gradient(135deg, hsl(${h}, 85%, 60%), hsl(${h2}, 85%, 40%));`;
}

function renderProductList(filterText = "") {
    const listEl = document.getElementById("product-list");
    listEl.innerHTML = "";
    
    let visibleProducts = products.filter(
        (p) => p.sale_status === undefined || p.sale_status === 1
    );

    if (filterText.trim()) {
        const lowerFilter = filterText.toLowerCase();
        visibleProducts = visibleProducts.filter(p =>
            p.name.toLowerCase().includes(lowerFilter) ||
            p.category?.toLowerCase().includes(lowerFilter) ||
            String(p.id).includes(lowerFilter)
        );
    }

    visibleProducts.forEach((p) => {
        const card = document.createElement("div");
        card.className = "product-card" + (p.id === currentProductId ? " active" : "");
        card.innerHTML = `
            <div class="product-card-title">${p.name}</div>
            <div class="product-card-meta">
                <span class="badge">${p.category}</span>
                <span class="product-price">${formatPriceVND(p.price)}</span>
            </div>
        `;
        card.addEventListener("click", () => {
            currentProductId = p.id;
            renderProductList(filterText);
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
        detailEl.innerHTML = '<i class="fas fa-box"></i><p>Chọn một sản phẩm để xem chi tiết</p>';
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
                    <span><strong>${formatPriceVND(product.price)}</strong></span>
                    <span>${formatRating(product.rating)}</span>
                    <span class="badge">${product.category}</span>
                </div>
                <div class="product-detail-id">ID: ${product.id}</div>
                <div class="product-detail-desc">${product.description || "Không có mô tả"}</div>
                <div class="detail-actions">
                    <button class="btn-add-cart" data-product-id="${product.id}">
                        <i class="fas fa-shopping-cart"></i> Thêm vào giỏ
                    </button>
                </div>
            </div>
        </div>
    `;

    // Add cart button event
    const addCartBtn = detailEl.querySelector('.btn-add-cart');
    if (addCartBtn) {
        addCartBtn.addEventListener('click', () => {
            addToCart(product);
        });
    }

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
            similarEl.innerHTML = '<p style="text-align:center; color: #9ca3af; padding: 20px;">Không có sản phẩm thường mua cùng</p>';
        } else if (currentAlgorithm === "upsale") {
            similarEl.innerHTML = '<p style="text-align:center; color: #9ca3af; padding: 20px;">Không tìm thấy sản phẩm nâng cấp</p>';
        } else {
            similarEl.innerHTML = '<p style="text-align:center; color: #9ca3af; padding: 20px;">Không tìm thấy sản phẩm tương tự</p>';
        }
        return;
    }

    similar.forEach((item) => {
        const card = document.createElement("div");
        card.className = "similar-card";
        card.innerHTML = `
            <div class="similar-card-header">
                <div class="similar-thumb" style="${getThumbStyle(item.product)}">
                    <span>${getInitials(item.product.name)}</span>
                </div>
                <div class="similar-main">
                    <div class="similar-card-title">${item.product.name}</div>
                </div>
            </div>
            <div class="similar-card-price">${formatPriceVND(item.product.price)}</div>
            <div class="similar-card-rating">${formatRating(item.product.rating)}</div>
            <div style="margin-top: 8px;">
                <span class="similar-score">${(item.score * 100).toFixed(0)}% match</span>
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

// ===== Cart Functions =====

function addToCart(product) {
    const existingItem = cart.find(item => item.id === product.id);
    if (existingItem) {
        existingItem.quantity++;
    } else {
        cart.push({ ...product, quantity: 1 });
    }
    updateCartCount();
    showCartNotification();
}

function removeFromCart(productId) {
    cart = cart.filter(item => item.id !== productId);
    updateCartCount();
    renderCartItems();
}

function updateCartCount() {
    const countEl = document.getElementById('cart-count');
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    countEl.textContent = totalItems;
}

function renderCartItems() {
    const cartItemsEl = document.getElementById('cart-items');
    
    if (cart.length === 0) {
        cartItemsEl.innerHTML = '<p class="empty-cart">Giỏ hàng trống</p>';
        return;
    }

    cartItemsEl.innerHTML = cart.map(item => `
        <div class="cart-item">
            <div class="cart-item-thumb" style="${getThumbStyle(item)}">
                ${getInitials(item.name)}
            </div>
            <div class="cart-item-content">
                <div class="cart-item-name">${item.name}</div>
                <div class="cart-item-price">${formatPriceVND(item.price)} x ${item.quantity}</div>
            </div>
            <button class="cart-item-remove" data-product-id="${item.id}">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `).join('');

    // Add remove handlers
    document.querySelectorAll('.cart-item-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            removeFromCart(parseInt(btn.dataset.productId));
        });
    });

    updateCartTotal();
}

function updateCartTotal() {
    const total = cart.reduce((sum, item) => {
        const price = Number(item.price) || 0;
        return sum + (price * item.quantity);
    }, 0);
    
    const totalEl = document.getElementById('cart-total');
    totalEl.textContent = `Tổng: ${total.toLocaleString('vi-VN', {style: 'currency', currency: 'VND'})}`;
}

function showCartNotification() {
    // Simple notification - can be enhanced with a toast notification
    console.log('Thêm vào giỏ hàng thành công!');
}

// ===== Algorithm 1: FBT =====

function recommendByFbt(allProducts, target, k = 10) {
    const key = String(target.id);
    const list = fbtIndex.get(key) || [];
    const recs = list.map((r) => ({ product: r.product, score: r.conf }));
    return dedupeRecommendations(recs, k);
}

// ===== Algorithm 2: SIM =====

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

// ===== Algorithm 3: UPSALE =====

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
            continue;
        }
        if (!tCat3 && tCat2 && cat2 && tCat2 !== cat2) {
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
    codeEl.textContent = code;
    codeEl.classList.remove("language-python");
    codeEl.classList.add("language-javascript");
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
    // Search functionality
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            renderProductList(e.target.value);
        });
    }

    // Recommendation algorithm switcher
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

    // Code panel toggler
    const toggleBtn = document.getElementById("btn-toggle-code");
    const codePanelContent = document.querySelector(".code-panel-content");
    if (toggleBtn && codePanelContent) {
        toggleBtn.addEventListener("click", () => {
            const isHidden = codePanelContent.style.display === "none";
            codePanelContent.style.display = isHidden ? "block" : "none";
        });
    }

    const btnPython = document.getElementById("btn-code-python");
    if (btnPython) {
        btnPython.addEventListener("click", () => {
            showPythonSource();
        });
    }

    // Cart modal
    const cartButton = document.getElementById('cart-button');
    const cartModal = document.getElementById('cart-modal');
    const modalClose = document.querySelector('.modal-close');

    if (cartButton && cartModal) {
        cartButton.addEventListener('click', () => {
            cartModal.classList.add('show');
            renderCartItems();
        });
    }

    if (modalClose && cartModal) {
        modalClose.addEventListener('click', () => {
            cartModal.classList.remove('show');
        });
    }

    // Close modal when clicking outside
    if (cartModal) {
        cartModal.addEventListener('click', (e) => {
            if (e.target === cartModal) {
                cartModal.classList.remove('show');
            }
        });
    }
}

window.addEventListener("DOMContentLoaded", () => {
    setupEvents();
    loadProducts();
});

// ===== Forecast Dashboard (Backend API) =====

const FORECAST_API_BASE = "http://127.0.0.1:8001";
const FORECAST_STATIC_META_PATH = "data/forecast_static_meta.json";
const FORECAST_STATIC_DEFAULT_MAE = 1.0478;
const FORECAST_STATIC_LOCATIONS = [
    "1000", "1001", "1002", "1003", "1004",
    "1005", "1006", "1007", "1008", "1009",
    "1010", "1011", "1012", "1013", "1014",
    "1015", "1016", "1017", "1018", "1019",
];
const FORECAST_MODE = ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "api"
    : "static";

const forecastState = {
    page: 1,
    pageSize: 20,
    totalPages: 0,
    location: "",
    mae: null,
    loading: false,
    staticRows: [],
    staticMae: null,
};

function getForecastConnectionHint() {
    return "Không kết nối được Forecast API (http://127.0.0.1:8001). Hãy chạy: python forecast_api.py";
}

function toForecastErrorMessage(err) {
    if (err instanceof TypeError && String(err.message).toLowerCase().includes("failed to fetch")) {
        return getForecastConnectionHint();
    }
    return err?.message || "Lỗi không xác định";
}

async function loadStaticForecastMeta() {
    try {
        const res = await fetch(FORECAST_STATIC_META_PATH);
        if (!res.ok) return null;
        const data = await res.json();
        if (typeof data?.mae === "number") return data;
        return null;
    } catch (_) {
        return null;
    }
}

function buildStaticForecastRows() {
    const byId = new Map(products.map((p) => [String(p.id), p]));
    const rows = [];

    if (Array.isArray(popularityRows) && popularityRows.length > 0) {
        for (const row of popularityRows) {
            const itemId = String(row.item_id ?? row.id ?? "");
            const product = byId.get(itemId);
            if (!itemId || !product) continue;

            const pop = Number(row.purchase_count ?? 0);
            const qty = Math.max(1, Math.round(Number.isFinite(pop) ? pop / 20 : 1));
            const actualQty = Math.max(1, Math.round(Number.isFinite(pop) ? pop / 18 : qty));

            // Use a wider hash space to avoid repetitive location values in first pages.
            const key = `${itemId}-${product.category || ""}-${product.category_l2 || ""}`;
            const hash = Math.abs(stringHash(key)) % FORECAST_STATIC_LOCATIONS.length;
            const location = FORECAST_STATIC_LOCATIONS[hash];
            rows.push({ location, item_id: itemId, qty, actual_qty: actualQty });
        }
    }

    if (rows.length === 0) {
        for (const p of products.slice(0, 1000)) {
            const itemId = String(p.id);
            const hash = Math.abs(stringHash(itemId)) % FORECAST_STATIC_LOCATIONS.length;
            rows.push({
                location: FORECAST_STATIC_LOCATIONS[hash],
                item_id: itemId,
                qty: 1,
                actual_qty: 1,
            });
        }
    }

    // Balance rows across locations so first pages are not dominated by one location.
    const buckets = new Map();
    for (const row of rows) {
        const key = String(row.location);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(row);
    }

    for (const [, list] of buckets.entries()) {
        list.sort((a, b) => {
            if (b.qty !== a.qty) return b.qty - a.qty;
            return String(a.item_id).localeCompare(String(b.item_id));
        });
    }

    const locations = [...buckets.keys()].sort();
    const merged = [];
    let hasData = true;
    while (hasData) {
        hasData = false;
        for (const loc of locations) {
            const list = buckets.get(loc);
            if (list && list.length > 0) {
                merged.push(list.shift());
                hasData = true;
            }
        }
    }

    return merged;
}

function calculateStaticMae(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    let sumAbsError = 0;
    let count = 0;

    for (const row of rows) {
        const pred = Number(row.qty);
        const actual = Number(row.actual_qty);
        if (!Number.isFinite(pred) || !Number.isFinite(actual)) continue;
        sumAbsError += Math.abs(pred - actual);
        count += 1;
    }

    if (count === 0) return null;
    return sumAbsError / count;
}

function paginateForecastRows(rows) {
    let filtered = rows;
    if (forecastState.location) {
        filtered = rows.filter((r) => String(r.location) === String(forecastState.location));
    }

    const totalRows = filtered.length;
    if (totalRows === 0) {
        return {
            rows: [],
            mae: forecastState.staticMae,
            page: 1,
            page_size: forecastState.pageSize,
            total_rows: 0,
            total_pages: 0,
            locations: [],
        };
    }

    const totalPages = Math.ceil(totalRows / forecastState.pageSize);
    const page = Math.max(1, Math.min(forecastState.page, totalPages));
    const start = (page - 1) * forecastState.pageSize;
    const end = start + forecastState.pageSize;

    const locations = [...new Set(rows.map((r) => String(r.location)))].sort();
    return {
        rows: filtered.slice(start, end),
        mae: forecastState.staticMae,
        page,
        page_size: forecastState.pageSize,
        total_rows: totalRows,
        total_pages: totalPages,
        locations,
    };
}

function setForecastStatus(message, isError = false) {
    const statusEl = document.getElementById("forecast-status");
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#b91c1c" : "";
}

function setForecastLoading(loading) {
    forecastState.loading = loading;
    const runBtn = document.getElementById("btn-run-forecast");
    if (runBtn) runBtn.disabled = loading;
}

function renderForecastRows(rows) {
    const tbody = document.getElementById("forecast-table-body");
    if (!tbody) return;

    if (!Array.isArray(rows) || rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="forecast-empty">Không có dữ liệu</td></tr>';
        return;
    }

    tbody.innerHTML = rows
        .map(
            (row) => `
                <tr>
                    <td>${row.location}</td>
                    <td>${row.item_id}</td>
                    <td>${row.qty}</td>
                </tr>
            `
        )
        .join("");
}

function renderForecastMeta(data) {
    const maeEl = document.getElementById("forecast-mae");
    const pageInfoEl = document.getElementById("forecast-page-info");
    const prevBtn = document.getElementById("forecast-prev-page");
    const nextBtn = document.getElementById("forecast-next-page");

    if (maeEl && typeof data.mae === "number") {
        forecastState.mae = data.mae;
        const maeDisplay =
            FORECAST_MODE === "static"
                ? (Math.floor(data.mae * 100) / 100).toFixed(2)
                : data.mae.toFixed(4);
        maeEl.textContent = `MAE: ${maeDisplay}`;
    } else if (maeEl) {
        maeEl.textContent = "MAE: N/A";
    }

    forecastState.page = Number(data.page || 1);
    forecastState.totalPages = Number(data.total_pages || 0);

    if (pageInfoEl) {
        pageInfoEl.textContent = `Trang ${forecastState.page}/${forecastState.totalPages}`;
    }

    if (prevBtn) {
        prevBtn.disabled = forecastState.page <= 1 || forecastState.totalPages === 0 || forecastState.loading;
    }
    if (nextBtn) {
        nextBtn.disabled =
            forecastState.page >= forecastState.totalPages ||
            forecastState.totalPages === 0 ||
            forecastState.loading;
    }
}

function populateForecastLocations(locations) {
    const selectEl = document.getElementById("forecast-location-filter");
    if (!selectEl) return;

    const current = selectEl.value;
    selectEl.innerHTML = '<option value="">Tất cả</option>';

    (locations || []).forEach((loc) => {
        const option = document.createElement("option");
        option.value = loc;
        option.textContent = loc;
        selectEl.appendChild(option);
    });

    if (["", ...(locations || [])].includes(current)) {
        selectEl.value = current;
    }
}

async function fetchForecastPage() {
    if (FORECAST_MODE === "static") {
        const data = paginateForecastRows(forecastState.staticRows);
        renderForecastRows(data.rows);
        renderForecastMeta(data);
        populateForecastLocations(data.locations);
        setForecastStatus(`Static mode: ${data.rows.length}/${data.total_rows} dòng`);
        return;
    }

    const query = new URLSearchParams({
        page: String(forecastState.page),
        page_size: String(forecastState.pageSize),
    });
    if (forecastState.location) query.set("location", forecastState.location);

    setForecastLoading(true);
    setForecastStatus("Đang tải dữ liệu forecast...");

    try {
        const res = await fetch(`${FORECAST_API_BASE}/api/forecast/results?${query.toString()}`);
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.detail || "Không thể lấy dữ liệu forecast");
        }

        renderForecastRows(data.rows);
        renderForecastMeta(data);
        populateForecastLocations(data.locations);
        setForecastStatus(`Đã tải ${data.rows.length}/${data.total_rows} dòng`);
    } catch (err) {
        renderForecastRows([]);
        setForecastStatus(`Lỗi: ${toForecastErrorMessage(err)}`, true);
    } finally {
        setForecastLoading(false);
    }
}

async function runForecastFromLocalData() {
    if (FORECAST_MODE === "static") {
        if (!Array.isArray(products) || products.length === 0) {
            setForecastStatus("Dữ liệu sản phẩm chưa tải xong, vui lòng thử lại sau vài giây", true);
            return;
        }

        setForecastLoading(true);
        setForecastStatus("Đang tạo forecast từ dữ liệu JSON local...");

        const staticMeta = await loadStaticForecastMeta();

        forecastState.page = 1;
        forecastState.location = "";
        forecastState.staticRows = buildStaticForecastRows();
        forecastState.staticMae =
            typeof staticMeta?.mae === "number"
                ? staticMeta.mae
                : FORECAST_STATIC_DEFAULT_MAE;

        const locationSelect = document.getElementById("forecast-location-filter");
        if (locationSelect) locationSelect.value = "";

        await fetchForecastPage();
        const maeLabel = Number.isFinite(forecastState.staticMae)
            ? forecastState.staticMae.toFixed(4)
            : "N/A";
        const sourceLabel = staticMeta ? "(MAE local precomputed)" : "(MAE local default)";
        setForecastStatus(`Static mode sẵn sàng. Tổng dòng: ${forecastState.staticRows.length}, MAE: ${maeLabel} ${sourceLabel}`);
        setForecastLoading(false);
        return;
    }

    setForecastLoading(true);
    setForecastStatus("Đang chạy forecast từ dữ liệu local trong data/... có thể mất vài giây");

    try {
        const res = await fetch(`${FORECAST_API_BASE}/api/forecast/run`, {
            method: "POST",
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.detail || "Forecast run thất bại");
        }

        forecastState.page = 1;
        forecastState.location = "";
        const locationSelect = document.getElementById("forecast-location-filter");
        if (locationSelect) locationSelect.value = "";

        setForecastStatus(`Run thành công (${data.items_file}, ${data.transactions_file}). Tổng dòng: ${data.total_rows}`);
        await fetchForecastPage();
    } catch (err) {
        setForecastStatus(`Lỗi: ${toForecastErrorMessage(err)}`, true);
    } finally {
        setForecastLoading(false);
    }
}

async function checkForecastApiHealth() {
    if (FORECAST_MODE === "static") {
        const staticMeta = await loadStaticForecastMeta();
        if (staticMeta) {
            setForecastStatus(`Static mode (deploy web): MAE local = ${Number(staticMeta.mae).toFixed(4)}. Nhấn Run Forecast để xem bảng.`);
        } else {
            setForecastStatus(`Static mode (deploy web): Chưa có forecast_static_meta.json, MAE dùng mặc định local = ${FORECAST_STATIC_DEFAULT_MAE.toFixed(4)}.`);
        }
        return;
    }

    try {
        const res = await fetch(`${FORECAST_API_BASE}/api/health`);
        if (!res.ok) throw new Error("Forecast API phản hồi lỗi");
        setForecastStatus("Forecast API đã sẵn sàng. Nhấn Run Forecast để chạy.");
    } catch (_) {
        setForecastStatus(getForecastConnectionHint(), true);
    }
}

function setupForecastEvents() {
    const runBtn = document.getElementById("btn-run-forecast");
    const prevBtn = document.getElementById("forecast-prev-page");
    const nextBtn = document.getElementById("forecast-next-page");
    const pageSizeEl = document.getElementById("forecast-page-size");
    const locationEl = document.getElementById("forecast-location-filter");

    if (runBtn) {
        runBtn.addEventListener("click", runForecastFromLocalData);
    }

    if (prevBtn) {
        prevBtn.addEventListener("click", async () => {
            if (forecastState.page > 1) {
                forecastState.page -= 1;
                await fetchForecastPage();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener("click", async () => {
            if (forecastState.page < forecastState.totalPages) {
                forecastState.page += 1;
                await fetchForecastPage();
            }
        });
    }

    if (pageSizeEl) {
        pageSizeEl.addEventListener("change", async (event) => {
            forecastState.pageSize = Number(event.target.value || 20);
            forecastState.page = 1;
            await fetchForecastPage();
        });
    }

    if (locationEl) {
        locationEl.addEventListener("change", async (event) => {
            forecastState.location = event.target.value;
            forecastState.page = 1;
            await fetchForecastPage();
        });
    }
}

window.addEventListener("DOMContentLoaded", () => {
    setupForecastEvents();
    checkForecastApiHealth();
});

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

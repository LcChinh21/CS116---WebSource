# 🛍️ Smart Product Recommendation Engine
abc
Một ứng dụng web hiện đại giới thiệu hệ thống gợi ý sản phẩm thông minh cho cửa hàng bán hàng trực tuyến. Ứng dụng hỗ trợ 3 giải pháp khuyến nghị khác nhau với giao diện người dùng sạch sẽ, dễ sử dụng và fully responsive.

## ✨ Tính năng chính

### 🎯 3 Giải pháp Khuyến nghị
- **FBT (Frequently Bought Together)** - Sản phẩm mua cùng nhất dựa trên dữ liệu giao dịch
- **SIM (Similarity)** - Sản phẩm tương tự theo danh mục và khoảng giá
- **UPSALE** - Sản phẩm nâng cấp (giá cao hơn, cùng danh mục)

### 🛒 Quản lý Giỏ hàng
- Thêm/xóa sản phẩm từ giỏ
- Tính tổng giá trị tự động
- Modal giỏ hàng thân thiện

### 🔍 Tìm kiếm và Lọc
- Tìm kiếm sản phẩm theo tên, ID
- Lọc theo danh mục
- Hiển thị thông tin chi tiết đầy đủ

### 💻 Xem Source Code
- Hiển thị code Python và JavaScript
- Syntax highlighting với Highlight.js
- Dễ dàng tìm hiểu logic thuật toán

### 📱 Responsive Design
- Tối ưu cho desktop, tablet, mobile
- Giao diện sạch sẽ, hiện đại (Light Theme)
- Smooth animations và transitions

---

## 🚀 Deployment

### Tùy chọn 1: Vercel (Khuyến nghị)
```bash
npm install -g vercel
vercel login
cd c:\Users\Admin\Desktop\SourceWeb
vercel --prod
```

### Tùy chọn 2: GitHub + Vercel Auto-Deploy
1. Push code lên GitHub repository
2. Kết nối repo với Vercel dashboard
3. Mỗi lần push → tự động deploy production

### Tùy chọn 3: Netlify
```bash
npm install -g netlify-cli
netlify deploy --prod --dir .
```

### Chạy Cục bộ
```bash
# Cách 1: Với Python
python -m http.server 8000
# Truy cập: http://localhost:8000

# Cách 2: Với Node.js
npx http-server
```

### Chạy Forecast Backend (mới)
```bash
# Cài dependencies (1 lần)
pip install fastapi uvicorn python-multipart polars

# Chạy API
python forecast_api.py

# API chạy tại
http://127.0.0.1:8001
```

Sau đó chạy web static như bình thường (`python -m http.server 8000`) và mở trang chính.
Trong phần `Sales Forecast Dashboard`, nhấn `Run Forecast` để chạy trực tiếp từ data local.
API sẽ tự chọn file parquet mới nhất theo thời gian sửa:
- `data/items*.parquet`
- `data/transactions*.parquet`

Ví dụ hiện tại sẽ dùng:
- `data/items (3).parquet`
- `data/transactions-2025-12 (1).parquet`

Kết quả hiển thị bảng 3 cột:
- `location`
- `item_id`
- `qty`

Kết quả được phân trang để tránh treo trình duyệt với dữ liệu lớn.

---

## 📁 Cấu trúc Thư mục

```
SourceWeb/
├── index.html                # Giao diện chính (HTML5)
├── styles.css                # Thiết kế (CSS3 - Variables, Flexbox, Grid)
├── app.js                    # Logic ứng dụng (Vanilla JavaScript)
├── recs_python.py            # Thuật toán khuyến nghị (Python)
├── build_fbt_json.py         # Script tính toán FBT
├── build_popularity_json.py  # Script tính độ phổ biến
├── convert_items_to_products.py # Script chuyển đổi dữ liệu
├── data/
│   ├── products.json         # Danh sách sản phẩm (100+ items)
│   ├── fbt_master.json       # FBT patterns (Frequently Bought Together)
│   └── popularity.json       # Độ phổ biến sản phẩm
├── README.md                 # Tài liệu này
├── .gitignore               # Ignore rules
└── .git/                    # Git repository
```

---

## 🔧 Hướng dẫn sử dụng

### Điều kiện tiên quyết
- Browser hiện đại: Chrome v90+, Firefox v88+, Safari v14+, Edge v90+
- Không cần Node.js, Python hay server (Static HTML site)
- Kết nối internet để load dữ liệu JSON

### 1. Chạy cục bộ
```bash
# Mở terminal tại thư mục SourceWeb
cd c:\Users\Admin\Desktop\SourceWeb

# Khởi động HTTP server
python -m http.server 8000

# Mở trình duyệt
http://localhost:8000
```

### 2. Sử dụng ứng dụng
1. **Chọn sản phẩm:** Click vào một sản phẩm trong danh sách bên trái
2. **Xem chi tiết:** Thông tin sản phẩm hiển thị ở phần trung tâm
3. **Chọn thuật toán:** Chuyển đổi giữa FBT, SIM, UPSALE
4. **Xem khuyến nghị:** Danh sách sản phẩm được gợi ý hiển thị bên dưới
5. **Thêm vào giỏ:** Click nút "Thêm vào giỏ" để thêm sản phẩm
6. **Quản lý giỏ:** Click icon giỏ hàng để xem, sửa, xóa sản phẩm
7. **Xem code:** Mở "Code Panel" để xem source code Python/JavaScript

---

## 📊 Chi tiết 3 Giải pháp Khuyến nghị

### 1️⃣ FBT (Frequently Bought Together)

**Ý tưởng:** Nếu khách mua sản phẩm A, họ có khả năng muốn mua sản phẩm B

**Công thức:**
```
Confidence Score = (Số lần mua cùng A & B) / (Số lần mua A)
```

**Ví dụ:** 
- Khách mua Tã Pampers M 176 lần
- Trong đó, 150 lần cũng mua Tã XL
- Confidence = 150 / 176 = 85.2%

**Dữ liệu:** `data/fbt_master.json`

---

### 2️⃣ SIM (Similarity)

**Ý tưởng:** Tìm sản phẩm tương tự dựa trên danh mục và mức giá

**Công thức:**
```
Similarity Score = (Category Match + Price Match) / 15

Category Match:
  - L3 (Mức 3) = 10 điểm
  - L2 (Mức 2) = 7 điểm  
  - L1 (Mức 1) = 5 điểm

Price Match:
  - Within ±20% = 5 điểm
  - Within ±50% = 3 điểm
  - Within ±100% = 2 điểm
```

**Ví dụ:**
- Tìm sản phẩm tương tự Tã M (50,000 VNĐ)
- Sản phẩm Tã XL (55,000 VNĐ, cùng L3)
- Score = (10 + 5) / 15 = 100%

---

### 3️⃣ UPSALE (Promote Higher-Priced Items)

**Ý tưởng:** Gợi ý sản phẩm đắt tiền hơn trong cùng danh mục để tăng doanh thu bình quân

**Công thức:**
```
Upsale Score = Co-Buy Count × (Size Rank Diff / 6)

Điều kiện:
- Phải trong cùng danh mục L3/L2
- Size phải cao hơn sản phẩm gốc (M → L → XL)
- Giá trong khoảng hợp lý
```

**Ví dụ:**
- Khách mua Tã M (176 lần mua, 150 lần mua kèm Tã XL)
- M = rank 2, XL = rank 4 (chênh 2 levels)
- Score = 150 × (2/6) = 50 điểm

---

## 🛠️ Công nghệ sử dụng

| Công nghệ | Mục đích | Phiên bản |
|-----------|---------|----------|
| **HTML5** | Cấu trúc trang | Latest |
| **CSS3** | Styling (Variables, Flexbox, Grid) | Latest |
| **JavaScript** | Logic ứng dụng (Vanilla - no frameworks) | ES6+ |
| **Font Awesome** | Icons | v6.4.0 |
| **Highlight.js** | Syntax highlighting | v11.9.0 |
| **JSON** | Lưu trữ dữ liệu | Standard |
| **Python** | Tính toán recommendation | 3.8+ |

---

## 📈 Cấu trúc Dữ liệu

### products.json
```json
[
  {
    "id": 1,
    "name": "Tã Pampers M",
    "category": "Tã em bé",
    "category_l1": "Chăm sóc em bé",
    "category_l2": "Tã",
    "category_l3": "Tã dán",
    "price": 250000,
    "rating": 4.5,
    "description": "Tã của Mỹ, mềm mại...",
    "size": "M"
  }
]
```

### fbt_master.json
```json
[
  {
    "a": "1",           // Product ID A
    "b": "2",           // Product ID B  
    "cnt": 150,         // Số lần mua A & B cùng
    "conf": 0.85,       // Confidence score
    "t_a": 176          // Tổng lần mua A
  }
]
```

### popularity.json
```json
[
  {
    "item_id": "1",
    "purchase_count": 5000
  }
]
```

---

## 🎨 Giao diện người dùng

| Thành phần | Chức năng |
|-----------|----------|
| **Navbar** | Branding, Search bar, Cart icon |
| **Sidebar** | Danh sách sản phẩm (scrollable) |
| **Main Content** | Chi tiết sản phẩm, khuyến nghị |
| **Code Panel** | Xem source code (collapsible) |
| **Cart Modal** | Quản lý giỏ hàng |
| **Footer** | Copyright info |

---

## 🔗 API & Data Loading

Ứng dụng này không có backend API, tất cả dữ liệu được load từ local JSON files:

```javascript
// Fetch products
fetch('data/products.json')
  .then(res => res.json())
  .then(data => { /* process */ })

// Fetch FBT data
fetch('data/fbt_master.json')
  .then(res => res.json())
  .then(data => { /* process */ })

// Fetch popularity data  
fetch('data/popularity.json')
  .then(res => res.json())
  .then(data => { /* process */ })
```

---

## 📝 Build Scripts

### Tạo dữ liệu FBT từ transactions
```bash
python build_fbt_json.py
# Output: data/fbt_master.json
```

### Tạo dữ liệu popularity
```bash
python build_popularity_json.py
# Output: data/popularity.json
```

### Chuyển đổi items → products
```bash
python convert_items_to_products.py
# Output: data/products.json
```

---

## 🐛 Troubleshooting

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|-----------|----------|
| Không load được dữ liệu | Thiếu JSON files | Kiểm tra folder `data/` |
| Khuyến nghị trống | Sản phẩm không có data | Thử sản phẩm khác |
| Cart không hoạt động | JavaScript error | Mở DevTools (F12) |
| Giao diện bị hỏng | Cache cũ | Clear cache → reload |
| Deploy không thành công | Node.js missing | Cài Node.js + npm |

---

## 📚 Tài liệu bổ sung

- [Recommendation Systems - Wikipedia](https://en.wikipedia.org/wiki/Recommender_system)
- [FBT Analysis - Ecommerce Platforms](https://ecommerce-platforms.com/glossary)
- [Fetch API - MDN Docs](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
- [CSS Variables - MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/--*)
- [ES6 JavaScript - MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide)

---

## 📜 License

MIT License - Tự do sử dụng, sửa đổi, phân phối

## 🤝 Đóng góp

Để báo cáo lỗi hoặc đề xuất tính năng:
1. Tạo Issue mới
2. Mô tả vấn đề/đề xuất chi tiết
3. Cung cấp ví dụ nếu có thể

---

## 👤 Tác giả

Xây dựng với ❤️ cho bán hàng trực tuyến thông minh

**Last Updated:** March 25, 2026  
**Version:** 2.0 (Modern UI with Shopping Cart)

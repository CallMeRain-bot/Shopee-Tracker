# API Check Order - tksieure.top

## Endpoint
```
POST https://tksieure.top/check_order
```

## Headers
```
Content-Type: application/x-www-form-urlencoded
Cookie: token=<TKSIEURE_TOKEN>
```

> ⚠️ **QUAN TRỌNG**: Cần 2 loại cookie:
> - `token` trong **Headers** - Cookie xác thực của tksieure.top
> - `SPC_ST` trong **Body** - Cookie Shopee để check order

## Request Payload (Form Data)
| Field   | Type   | Required | Description |
|---------|--------|----------|-------------|
| cookie  | string | ✅       | Cookie `SPC_ST` từ Shopee (URL-encoded) |
| proxy   | string | ❌       | Proxy (optional) |

### Ví dụ payload (URL-encoded):
```
cookie=SPC_ST%3D.TnczRWxDQUZUTE5pekI4MJY70TGRh0YncKLLEHourrtfH3hkNCYgTco3GDDkKct%2BuW5Ir6hA2Se1hzmzHN4g2grQGg4VxsrbCaam94kDXWZeyikZkdD8xsPIdMOrMaVh0Hodwik7KMd1QpZCU9dfnXqy9lj6D67%2BY4jzjxmcxblQy12t5qw37%2BHrKwggSbS0YSXXDA7XzEvxisJ%2BqmJr6%2BIRwLeqJ4AH0Pt7e9O2elHTr1wkWkvH6ikM%2BDsQpAj7B675JrbFRKRMxOaqTJOFdA%3D%3D&proxy=
```

---

## Response Format

API trả về **HTML** (không phải JSON). Cần parse `<div id="result">` để lấy data.

### HTML Structure
```html
<div id="result">
  <div class="success-box">
    <h3>📋 Kết quả check X cookie:</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>Order</th>
          <th>Thời Gian</th>
          <th>Shop</th>
          <th>Vận Đơn</th>
          <th>Trạng Thái</th>
          <th>Người Nhận</th>
          <th>Sản Phẩm</th>
          <th>Giá</th>
          <th>Thanh Toán</th>
        </tr>
      </thead>
      <tbody>
        <tr><!-- Order data --></tr>
      </tbody>
    </table>
  </div>
</div>
```

### Cách Parse Data

| Field | Selector | Ví dụ |
|-------|----------|-------|
| Order ID | `.order-id` | `224004746255220` |
| Order SN | `onclick='copyToClipboard("...")'` | `26020504DEC6UM` |
| Thời gian | `.time-badge` | `05/02/2026 22:32:27` |
| Shop | `.shop-badge` | `Aimili mask shop .vn` |
| Mã vận đơn | `.tracking` | `VN262287118779V` |
| Trạng thái | `.status-badge` | `Đơn hàng đã được nhập khẩu...` |
| Tên người nhận | `.addr-name strong` | `Minhh Vũ` |
| SĐT | `.addr-phone` (sau icon 📱) | `84564462378` |
| Địa chỉ | `.addr-address small` | `Tạp Hóa Nhâm Thanh...` |
| Sản phẩm | `.prod-list li` | Tên + giá + số lượng |
| Tổng thanh toán | `.price-value-total` | `17.080 ₫` |
| Phương thức TT | `.payment-badge` | `Thanh toán khi nhận hàng` |

---

## Lưu ý khi gọi từ VPS

⚠️ Server yêu cầu **TLS 1.2** - không hỗ trợ TLS 1.3

### cURL
```bash
curl --tls-max 1.2 -X POST 'https://tksieure.top/check_order' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Cookie: token=YOUR_TKSIEURE_TOKEN' \
  -d 'cookie=SPC_ST%3D...&proxy='
```

### Node.js
```javascript
const https = require('https');

const SHOPEE_COOKIE = 'SPC_ST=...';
const TKSIEURE_TOKEN = 'WGo9wVIl4u...';

const postData = `cookie=${encodeURIComponent(SHOPEE_COOKIE)}&proxy=`;

const options = {
  hostname: 'tksieure.top',
  path: '/check_order',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': postData.length,
    'Cookie': `token=${TKSIEURE_TOKEN}`,
  },
  maxVersion: 'TLSv1.2',
  minVersion: 'TLSv1.2',
};
```

### Parse HTML Response (Node.js)
```javascript
const cheerio = require('cheerio');

function parseOrdersFromHtml(html) {
  const $ = cheerio.load(html);
  const orders = [];

  $('#result .data-table tbody tr').each((i, row) => {
    const $row = $(row);
    orders.push({
      orderId: $row.find('.order-id').text().trim(),
      time: $row.find('.time-badge').text().trim(),
      shop: $row.find('.shop-badge').text().trim(),
      tracking: $row.find('.tracking').text().trim(),
      status: $row.find('.status-badge').text().trim(),
      recipient: {
        name: $row.find('.addr-name strong').text().trim(),
        phone: $row.find('.addr-phone').text().replace('📱', '').trim(),
        address: $row.find('.addr-address small').text().trim(),
      },
      total: $row.find('.price-value-total').text().trim(),
      payment: $row.find('.payment-badge').text().trim(),
    });
  });

  return orders;
}
```

---

## Error Cases

| HTTP Code | Nguyên nhân |
|-----------|-------------|
| 302 → `/client/login` | Cookie `token` không hợp lệ hoặc hết hạn |
| SSL timeout | Server không ổn định, cần retry |
| Empty result | Cookie `SPC_ST` không hợp lệ hoặc không có đơn hàng |
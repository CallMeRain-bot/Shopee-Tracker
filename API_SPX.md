# SPX Express Tracking API Documentation

## API Endpoint

| Field | Value |
|-------|-------|
| **URL** | `https://tramavandon.com/api/spx.php` |
| **Method** | `POST` |
| **Content-Type** | `application/json` |

---

## Request

### Headers
```
Content-Type: application/json
Origin: https://tramavandon.com
Referer: https://tramavandon.com/spx/
```

### Body
```json
{
    "tracking_id": "SPXVN064277700691"
}
```

**Supported tracking formats:**
- `SPXVN0XXXXXXXXXX` - SPX VN domestic
- `VN26XXXXXXXXXX` - SPX international waybill

---

## Response Structure

```json
{
    "retcode": 0,
    "data": {
        "fulfillment_info": {
            "deliver_type": 1
        },
        "sls_tracking_info": {
            "sls_tn": "VN261084171091B",
            "client_order_id": "5880522345806336610",
            "receiver_name": "",
            "records": [/* tracking events */]
        },
        "is_instant_order": false,
        "is_shopee_market_order": true
    },
    "message": "success",
    "detail": "",
    "_meta": {
        "endpoint": "spx.vn",
        "proxy_used": true,
        "http_code": 200,
        "ts": 1770645288
    }
}
```

---

## Tracking Event Object

Each event in `data.sls_tracking_info.records[]`:

```json
{
    "tracking_code": "F980",
    "tracking_name": "Delivered",
    "description": "Giao hàng thành công",
    "display_flag": 1,
    "actual_time": 1769246772,
    "reason_code": "R00",
    "reason_desc": "R00",
    "epod": "",
    "current_location": {
        "location_name": "21-HNI Thanh Tri 2 Hub",
        "location_type_name": "",
        "lng": "105.855451",
        "lat": "20.946142",
        "full_address": "VN Hà Nội Huyện Thanh Trì..."
    },
    "next_location": {
        "location_name": "",
        "lng": "",
        "lat": "",
        "full_address": ""
    },
    "display_flag_v2": 13,
    "buyer_description": "Giao hàng thành công",
    "seller_description": "Giao hàng thành công",
    "milestone_code": 8,
    "milestone_name": "Delivered"
}
```

### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `tracking_code` | string | Mã tracking (F980, F600, F510...) |
| `tracking_name` | string | Tên tiếng Anh của trạng thái |
| `description` | string | Mô tả tiếng Việt |
| `actual_time` | number | **Unix timestamp** (giây) |
| `display_flag` | number | 0 = ẩn, 1 = hiển thị |
| `display_flag_v2` | number | Cờ hiển thị v2 |
| `buyer_description` | string | Mô tả cho người mua |
| `seller_description` | string | Mô tả cho người bán |
| `milestone_code` | number | Mã milestone (1-8) |
| `milestone_name` | string | Tên milestone |
| `current_location` | object | Vị trí hiện tại (có thể rỗng) |
| `next_location` | object | Vị trí tiếp theo (có thể rỗng) |

---

## Tracking Codes Reference

| Code | Name | Milestone | Description |
|------|------|-----------|-------------|
| `A000` | SLSTN Created | 1 | Đơn hàng đã được tạo |
| `F000` | Manifested | 1 | Người gửi đang chuẩn bị hàng |
| `F100` | Pickup From Domestic Seller | 5 | Đã lấy hàng thành công |
| `F440` | Enter Domestic First Mile Hub | 5 | Đơn hàng đã đến bưu cục |
| `F441` | Loaded to Truck in First Mile Hub | 5 | Đã lên xe trung chuyển |
| `F445` | Packed in First Mile Hub | 5 | Đã phân loại |
| `F450` | Left Domestic First Mile Hub | 5 | Đã xuất khỏi kho |
| `F510` | Enter Domestic Sorting Center | 5 | Đã đến kho phân loại |
| `F515` | Packed in Domestic Sorting Centre | 5 | Đã phân loại tại kho lớn |
| `F540` | Left Domestic Sorting Center | 5 | Đã rời kho phân loại |
| `F541` | Loaded to Truck in Sorting Centre | 5 | Đã lên xe từ kho phân loại |
| `F580` | Domestic Line Haul End | 5 | Đang đến trạm giao hàng |
| `F598` | Delivery Driver Assigned | 5 | Đã sắp xếp tài xế |
| `F599` | Enter Last Mile Hub | 5 | Đã đến trạm giao hàng |
| `F600` | Out For Delivery | 6 | Đang giao hàng |
| `F980` | Delivered | 8 | Giao hàng thành công |

---

## Milestone Codes

| Code | Name |
|------|------|
| 1 | Preparing to ship |
| 5 | In transit |
| 6 | Out for delivery |
| 8 | Delivered |

---

## Time Parsing

`actual_time` is **Unix timestamp in seconds**. Convert to readable date:

**JavaScript:**
```javascript
const date = new Date(actual_time * 1000);
const formatted = date.toLocaleString('vi-VN');
// Output: "24/01/2026, 20:06:12"
```

**Python:**
```python
from datetime import datetime
date = datetime.fromtimestamp(actual_time)
formatted = date.strftime('%d/%m/%Y %H:%M')
# Output: "24/01/2026 20:06"
```

---

## Example Usage

### cURL
```bash
curl -X POST "https://tramavandon.com/api/spx.php" \
  -H "Content-Type: application/json" \
  -d '{"tracking_id":"SPXVN064277700691"}'
```

### JavaScript (fetch)
```javascript
const response = await fetch('https://tramavandon.com/api/spx.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tracking_id: 'SPXVN064277700691' })
});
const data = await response.json();
const records = data.data.sls_tracking_info.records;
```

### PowerShell
```powershell
$response = Invoke-RestMethod -Uri "https://tramavandon.com/api/spx.php" `
    -Method POST -ContentType "application/json" `
    -Body '{"tracking_id":"SPXVN064277700691"}'
$response.data.sls_tracking_info.records
```

---

## Notes

- Records are ordered from **newest to oldest**
- `display_flag = 1` means visible to customer
- Location data may be empty for some tracking events
- API uses proxy internally (`_meta.proxy_used`)
- Response is cached (`cache_time` field)
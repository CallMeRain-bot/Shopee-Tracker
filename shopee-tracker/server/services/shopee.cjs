const axios = require('axios');
const https = require('https');

// ========== CONFIG ==========
const TKSIEURE_API_URL = 'https://www.nganmiu.store/';
const TKSIEURE_TOKEN = process.env.TKSIEURE_TOKEN || ''; // Giữ biến này nếu cần auth trong tương lai

// Helper: Timestamp cho log
function ts() {
    return new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

// TLS 1.2 agent for tksieure.top
const tlsAgent = new https.Agent({
    maxVersion: 'TLSv1.2',
    minVersion: 'TLSv1.2',
});

// ========== API MỚI (tksieure.top) - Hỗ trợ Single Cookie ==========
async function fetchOrders(cookie) {
    return fetchOrdersBatch([cookie]);
}

// ========== API MỚI (tksieure.top) - Hỗ trợ BATCH COOKIES ==========
async function fetchOrdersBatch(cookies) {
    if (!cookies || cookies.length === 0) return [];

    try {
        console.log(`[${ts()}] [TKSieure API] 🔄 Gọi API TKSieure (Batch: ${cookies.length} cookies)...`);

        // Clean và gộp các cookies bằng %0D%0A (\r\n)
        const cleanCookies = cookies.map(cookie => {
            let clean = cookie;
            if (cookie.includes('SPC_ST=')) {
                clean = cookie.split('SPC_ST=')[1]?.split(';')[0] || cookie;
                clean = 'SPC_ST=' + clean;
            } else if (!cookie.startsWith('SPC_ST=')) {
                clean = 'SPC_ST=' + clean;
            }
            return clean;
        });

        // Nối các cookie bằng \r\n (CRLF) và url encode
        const combinedCookies = cleanCookies.join('\r\n');
        const postData = `cookies=${encodeURIComponent(combinedCookies)}&action=check`;

        const response = await axios.post(TKSIEURE_API_URL, postData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Origin': 'https://www.nganmiu.store',
                'Referer': 'https://www.nganmiu.store/'
            },
            httpsAgent: tlsAgent,
            timeout: 60000,
            validateStatus: (status) => status < 500,
        });

        const html = response.data;
        const contentType = response.headers['content-type'] || '';

        // console.log(`[${ts()}] [TKSieure API] 🛰️ Status: ${response.status} | Content-Type: ${contentType} | Body Size: ${String(html).length} bytes`);

        // Luôn lưu lại để soi
        require('fs').writeFileSync('debug_response.html', String(html));

        if (contentType.includes('text/html') || (typeof html === 'string' && html.includes('<html'))) {
            const orders = parseHtmlResponse(html);
            return orders;
        } else {
            const orders = parseData(html);
            return orders;
        }
    } catch (e) {
        if (e.response?.status === 302) {
            console.log(`[${ts()}] [TKSieure API] ⚠️ Token hết hạn hoặc không hợp lệ`);
            throw new Error('TKSieure token expired. Please update TKSIEURE_TOKEN.');
        }
        console.error(`[${ts()}] [TKSieure API] ❌ Lỗi: ${e.message}`);
        throw new Error(e.response ? `API Error: ${e.response.status}` : e.message);
    }
}

// ========== PARSE HTML RESPONSE (NGANMIU.STORE - MOBILE CARD) ==========
function parseHtmlResponse(html) {
    const results = [];

    if (html.includes('Cookie die') || html.includes('hết hạn')) {
        console.log(`[${ts()}] [NganMiu API] ❌ Có cookie hết hạn (Cookie die)`);
        throw new Error('COOKIE_EXPIRED_ERROR_19');
    }

    console.log(`[${ts()}] [NganMiu API] Đang quét HTML (Mobile Cards)...`);

    // Tách từng khối mobile-order-card (split thay vì regex global để tránh bị hụt thẻ div)
    const cardBlocks = html.split(/<div[^>]*class=['"]mobile-order-card/gi).slice(1);

    for (let cardBody of cardBlocks) {
        try {
            const order = {};

            // 0. Lấy số thứ tự đơn (Dùng làm Cookie Index theo ý onichan)
            const indexMatch = cardBody.match(/ĐƠN\s*(\d+)/i);
            if (indexMatch) {
                order.cookie_index = parseInt(indexMatch[1]);
            }

            // 1. Ảnh sản phẩm (Target thẳng link shopee theo ý onichan)
            const imgMatch = cardBody.match(/https:\/\/cf\.shopee\.vn\/file\/([^'"?\s>]+)/i);
            order.image = imgMatch ? imgMatch[1] : null;

            // 2. Mã vận đơn (Lấy từ nút copy)
            const trackingMatch = cardBody.match(/data-copy=['"](SPX[^'"]+|VN[^'"]+|G[^'"]+)['"]/i);
            order.tracking_number = trackingMatch ? trackingMatch[1].trim() : 'Không xác định';

            // 3. Trạng thái
            const statusMatch = cardBody.match(/class=['"]value status-text[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i);
            order.status = statusMatch ? statusMatch[1].replace(/<[^>]+>/g, '').trim() : 'Đang xử lý';

            // 4. Sản phẩm
            const productMatch = cardBody.match(/class=['"]product-name['"]>([^<]+)/i);
            order.product = productMatch ? productMatch[1].trim() : 'Sản phẩm Shopee';
            order.amount = 1;

            // 5. Giá tiền (COD)
            const priceMatch = cardBody.match(/class=['"]cod-amount['"]>([^<]+)/i);
            order.price = priceMatch ? parseInt(priceMatch[1].replace(/[^\d]/g, '')) : 0;

            // 6. Thông tin người nhận
            const nameMatch = cardBody.match(/Người nhận:<\/span>[\s\S]*?<span[^>]*class=['"]d-value['"]>([^<]+)/i);
            const phoneMatch = cardBody.match(/SĐT nhận:<\/span>[\s\S]*?<a[^>]*class=['"]d-value d-phone['"][^>]*>([^<]+)/i);
            order.shipping = {
                name: nameMatch ? nameMatch[1].trim() : 'Khách hàng',
                phone: phoneMatch ? phoneMatch[1].trim() : 'N/A',
            };

            // 7. 🔥 TẠO ID (Dùng Tên Sản phẩm + SĐT)
            const idPhone = order.shipping.phone !== 'N/A' ? `_${order.shipping.phone}` : '';
            order.id = order.product + idPhone;

            const statusLower = order.status.toLowerCase();
            order.is_completed = statusLower.includes('thành công') || statusLower.includes('đã giao') || statusLower.includes('hoàn tất');
            order.is_cancelled = statusLower.includes('đã hủy') || statusLower.includes('huỷ');

            results.push(order);
        } catch (e) {
            console.error(`[NganMiu API] Lỗi parse: ${e.message}`);
        }
    }

    return results;
}

// ========== PARSE JSON RESPONSE (API CŨ - Backward Compatible) ==========
function parseData(apiData) {
    const allDetails = apiData?.allOrderDetails || [];
    let result = [];

    for (const detailGroup of allDetails) {
        const orderList = detailGroup.orderDetails || [];

        for (const order of orderList) {
            try {
                const product = order.product_info?.[0] || {};

                result.push({
                    id: order.order_id,
                    shop_id: product.shop_id,
                    shop: `Shop ID ${product.shop_id}`,
                    product: product.model_name
                        ? `${product.name || "Sản phẩm"} - ${product.model_name}`
                        : (product.name || "Sản phẩm"),
                    amount: product.amount || 1,
                    image: product.image || null,
                    tracking_number: order.tracking_number || "Không xác định",
                    price: (product.item_price / 100000) || 0,
                    status: order.tracking_info_description || "Đang xử lý",
                    is_completed:
                        (order.tracking_info_description || "").toLowerCase().includes('giao hàng thành công') ||
                        (order.tracking_info_description || "").toLowerCase().includes('đã giao'),
                    is_cancelled:
                        (order.tracking_info_description || "").toLowerCase().includes('đã hủy'),
                    shipping: {
                        name: order.address?.shipping_name || "N/A",
                        phone: order.address?.shipping_phone || "N/A",
                    }
                });
            } catch (e) { console.error("Parse error:", e); }
        }
    }

    return result;
}

module.exports = { fetchOrders, fetchOrdersBatch, parseData, parseHtmlResponse };

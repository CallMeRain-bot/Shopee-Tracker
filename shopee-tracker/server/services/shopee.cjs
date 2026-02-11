const axios = require('axios');
const https = require('https');

// ========== CONFIG ==========
const TKSIEURE_API_URL = 'https://tksieure.top/check_order';
const TKSIEURE_TOKEN = process.env.TKSIEURE_TOKEN || '';

// TLS 1.2 agent for tksieure.top
const tlsAgent = new https.Agent({
    maxVersion: 'TLSv1.2',
    minVersion: 'TLSv1.2',
});

// ========== API MỚI (tksieure.top) ==========
async function fetchOrders(cookie) {
    try {
        console.log('[Shopee API] 🔄 Calling TKSieure API...');

        // Clean cookie - lấy value của SPC_ST
        let cleanCookie = cookie;
        if (cookie.includes('SPC_ST=')) {
            cleanCookie = cookie.split('SPC_ST=')[1]?.split(';')[0] || cookie;
            cleanCookie = 'SPC_ST=' + cleanCookie;
        }

        // URL encode the cookie value
        const cookieValue = cleanCookie.startsWith('SPC_ST=')
            ? cleanCookie.substring(7)
            : cleanCookie;

        const postData = `cookie=${encodeURIComponent('SPC_ST=' + cookieValue)}&proxy=`;

        const response = await axios.post(TKSIEURE_API_URL, postData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': TKSIEURE_TOKEN ? `token=${TKSIEURE_TOKEN}` : '',
            },
            httpsAgent: tlsAgent,
            timeout: 30000,
            maxRedirects: 0, // Không follow redirect
            validateStatus: (status) => status < 400,
        });

        // Check if response is HTML (API mới) or JSON (API cũ)
        const contentType = response.headers['content-type'] || '';

        if (contentType.includes('text/html')) {
            // Parse HTML response (API mới)
            const orders = parseHtmlResponse(response.data);
            console.log(`[Shopee API] ✅ Got ${orders.length} orders from TKSieure`);
            return orders;
        } else {
            // Parse JSON response (API cũ format)
            const orders = parseData(response.data);
            console.log(`[Shopee API] ✅ Got ${orders.length} orders (JSON format)`);
            return orders;
        }
    } catch (e) {
        // Nếu bị redirect về login => token hết hạn
        if (e.response?.status === 302) {
            console.log('[Shopee API] ⚠️ Token expired or invalid');
            throw new Error('TKSieure token expired. Please update TKSIEURE_TOKEN.');
        }
        console.log('[Shopee API] ❌ Error:', e.message);
        throw new Error(e.response ? `API Error: ${e.response.status}` : e.message);
    }
}

// ========== PARSE HTML RESPONSE (API MỚI) ==========
function parseHtmlResponse(html) {
    const results = [];

    // Kiểm tra Error 19 - Cookie Hết Hạn
    if (html.includes('Cookie Hết Hạn') || html.includes('Error 19')) {
        console.log('[Shopee API] ❌ Cookie expired (Error 19)');
        throw new Error('COOKIE_EXPIRED_ERROR_19');
    }

    // Kiểm tra xem có data không
    if (!html.includes('data-table') || !html.includes('order-id')) {
        console.log('[Shopee API] No order data found in HTML');
        return results;
    }

    console.log('[Shopee API] Found data-table, parsing...');

    // Tìm tất cả các row trong tbody
    const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
    if (!tbodyMatch) {
        console.log('[Shopee API] No tbody found');
        return results;
    }

    const tbody = tbodyMatch[1];
    const rowRegex = /<tr>([\s\S]*?)<\/tr>/gi;
    const rows = tbody.match(rowRegex) || [];

    for (const row of rows) {
        // Skip header row
        if (row.includes('<th>')) continue;

        try {
            const order = {};

            // Order ID - HTML có lỗi: class='order-id>'224004746255220 (thiếu quote đóng)
            const orderIdMatch = row.match(/order-id['"]?>['"]*([\d]+)/i);
            order.id = orderIdMatch ? orderIdMatch[1] : null;

            if (!order.id) continue; // Skip nếu không có order ID

            // Tracking number - format: class='tracking'>VN262287118779V
            const trackingMatch = row.match(/tracking['"]?>([A-Z0-9]+)/i);
            order.tracking_number = trackingMatch ? trackingMatch[1].trim() : 'Không xác định';

            // Status
            const statusMatch = row.match(/class=['"]status-badge['"]>([^<]+)/i);
            order.status = statusMatch ? statusMatch[1].trim() : 'Đang xử lý';

            // Shop name
            const shopMatch = row.match(/class=['"]shop-badge['"]>([^<]+)/i);
            order.shop = shopMatch ? shopMatch[1].trim() : 'Unknown Shop';

            // Recipient info (address removed for security)
            const nameMatch = row.match(/class=['"]addr-name['"]><strong>([^<]+)/i);
            const phoneMatch = row.match(/class=['"]addr-phone['"][^>]*>[\s\S]*?(\d{10,12})/i);

            order.shipping = {
                name: nameMatch ? nameMatch[1].trim() : 'N/A',
                phone: phoneMatch ? phoneMatch[1].trim() : 'N/A',
            };

            // Product info
            const productMatch = row.match(/class=['"]prod-list['"][\s\S]*?<span>([^<]+)/i);
            const modelMatch = row.match(/<small>\(([^)]+)\)<\/small>/i);
            order.product = productMatch ? productMatch[1].trim() : 'Sản phẩm';
            if (modelMatch) {
                order.product += ' - ' + modelMatch[1].trim();
            }

            // Amount
            const amountMatch = row.match(/x\s*(\d+)<\/small>/i);
            order.amount = amountMatch ? parseInt(amountMatch[1]) : 1;

            // Image
            const imgMatch = row.match(/class=['"]prod-list['"][\s\S]*?<img[^>]+src=['"]([^'"]+)/i);
            if (imgMatch) {
                // Extract image ID from full URL
                const imgUrl = imgMatch[1];
                const imgIdMatch = imgUrl.match(/\/file\/([^'"?]+)/);
                order.image = imgIdMatch ? imgIdMatch[1] : imgUrl;
            } else {
                order.image = null;
            }

            // Price - lấy từ price-value-total
            const priceMatch = row.match(/class=['"]price-value-total['"]>([^<]+)/i);
            if (priceMatch) {
                // Parse "17.080 ₫" thành số
                const priceStr = priceMatch[1].replace(/[^\d]/g, '');
                order.price = parseInt(priceStr) || 0;
            } else {
                order.price = 0;
            }

            // Shop ID (không có trong API mới)
            order.shop_id = null;

            // Completed / Cancelled status
            const statusLower = order.status.toLowerCase();
            order.is_completed = statusLower.includes('giao hàng thành công') ||
                statusLower.includes('đã giao') ||
                statusLower.includes('hoàn tất');
            order.is_cancelled = statusLower.includes('đã hủy') ||
                statusLower.includes('huỷ');

            console.log(`[Shopee API] Parsed order: ${order.id}, tracking: ${order.tracking_number}`);
            results.push(order);
        } catch (e) {
            console.error('[Shopee API] Parse row error:', e.message);
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

module.exports = { fetchOrders, parseData, parseHtmlResponse };

/**
 * GHN (Giao Hàng Nhanh) API Client
 * Gọi API công khai của GHN để lấy trạng thái đơn hàng
 * 
 * @module services/ghn
 */

const axios = require('axios');

const GHN_API_URL = 'https://fe-online-gateway.ghn.vn/order-tracking/public-api/client/tracking-logs';

// Helper: Timestamp cho log
function ts() {
    return new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Fetch trạng thái đơn hàng từ GHN API
 * @param {string} trackingNumber - Mã vận đơn (VD: VNGH80673963310)
 * @returns {Promise<Object>} Parsed tracking status
 */
async function fetchGHNStatus(trackingNumber) {
    try {
        // console.log(`[${ts()}] [GHN API] 🔄 Gọi API GHN cho MVD: ${trackingNumber}`);
        const response = await axios.post(
            GHN_API_URL,
            { order_code: trackingNumber },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Origin': 'https://donhang.ghn.vn',
                    'Referer': 'https://donhang.ghn.vn/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 15000,
                validateStatus: (status) => status < 500 // Accept 204 as valid response
            }
        );

        // Handle 204 No Content - không phải đơn GHN
        if (response.status === 204 || !response.data) {
            console.log(`[${ts()}] [GHN API] ⚠️ MVD ${trackingNumber}: Không phải đơn GHN (204 No Content)`);
            return {
                success: false,
                trackingNumber,
                carrier: 'GHN',
                error: 'Not a GHN order',
                unsupportedCarrier: true  // Flag để biết cần fallback
            };
        }

        const data = response.data;

        // Check API response
        if (data.code !== 200 || !data.data?.tracking_logs?.length) {
            return {
                success: false,
                trackingNumber,
                carrier: 'GHN',
                error: data.message || 'No tracking data found',
                unsupportedCarrier: !data.data  // Nếu không có data thì không phải GHN
            };
        }

        const logs = data.data.tracking_logs;
        // GHN: logs mới nhất ở CUỐI mảng
        const latestLog = logs[logs.length - 1];

        // Convert ISO timestamp to Unix
        const timestamp = latestLog.action_at
            ? Math.floor(new Date(latestLog.action_at).getTime() / 1000)
            : null;

        return {
            success: true,
            trackingNumber,
            carrier: 'GHN',

            currentStatus: {
                code: latestLog.action_code,        // DELIVER_IN_TRIP, etc.
                name: latestLog.status,              // delivered, delivering, etc.
                description: latestLog.status_name,  // Tiếng Việt
                timestamp
            },

            // Flags chuẩn hóa
            isDelivered: latestLog.status === 'delivered',
            isInTransit: ['transporting', 'delivering', 'storing'].includes(latestLog.status),
            isPreparing: latestLog.status === 'picking',
            isReturned: latestLog.status === 'return',

            rawLogsCount: logs.length
        };

    } catch (error) {
        console.error(`[${ts()}] [GHN API] ❌ MVD ${trackingNumber}: ${error.message}`);
        return {
            success: false,
            trackingNumber,
            carrier: 'GHN',
            error: error.response?.data?.message || error.message
        };
    }
}

module.exports = { fetchGHNStatus };

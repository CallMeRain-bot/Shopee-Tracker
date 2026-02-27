/**
 * SPX (Shopee Express) API Client
 * Gọi API bên thứ 3 để lấy trạng thái đơn hàng SPX
 * 
 * @module services/spx
 */

const axios = require('axios');

const SPX_API_URL = 'https://tramavandon.com/api/spx.php';

// Helper: Timestamp cho log
function ts() {
    return new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Fetch trạng thái đơn hàng từ SPX API
 * @param {string} trackingNumber - Mã vận đơn (VD: SPXVN068797458621)
 * @returns {Promise<Object>} Parsed tracking status
 */
async function fetchSPXStatus(trackingNumber) {
    try {
        // console.log(`[${ts()}] [SPX API] 🔄 Gọi API SPX cho MVD: ${trackingNumber}`);
        const { data } = await axios.post(
            SPX_API_URL,
            { tracking_id: trackingNumber },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 15000
            }
        );

        // Check API response
        if (data.message !== 'success' || !data.data?.sls_tracking_info?.records?.length) {
            console.log(`[${ts()}] [SPX API] ⚠️ MVD ${trackingNumber}: Không có dữ liệu tracking`);
            return {
                success: false,
                trackingNumber,
                carrier: 'SPX',
                error: 'No tracking data found'
            };
        }

        const records = data.data.sls_tracking_info.records;
        const latestRecord = records[0]; // Record mới nhất ở đầu mảng

        return {
            success: true,
            trackingNumber,
            carrier: 'SPX',

            currentStatus: {
                code: latestRecord.tracking_code,           // F980, F600, etc.
                name: latestRecord.tracking_name,           // Delivered, Out For Delivery
                description: latestRecord.buyer_description, // Tiếng Việt
                timestamp: latestRecord.actual_time          // Unix timestamp
            },

            // Location info - vị trí hiện tại và điểm đến tiếp theo
            currentLocation: latestRecord.current_location?.location_name || null,
            nextLocation: latestRecord.next_location?.location_name || null,

            // Flags chuẩn hóa
            isDelivered: latestRecord.milestone_code === 8,
            isInTransit: [5, 6].includes(latestRecord.milestone_code),
            isPreparing: latestRecord.milestone_code === 1,
            isReturned: false, // SPX không có return status rõ ràng

            rawRecordsCount: records.length,
            records: records // 🔥 Trả về luôn full records
        };

    } catch (error) {
        console.error(`[${ts()}] [SPX API] ❌ MVD ${trackingNumber}: ${error.message}`);
        return {
            success: false,
            trackingNumber,
            carrier: 'SPX',
            error: error.response?.data?.message || error.message
        };
    }
}

/**
 * Fetch full tracking records from SPX API
 * @param {string} trackingNumber 
 */
async function fetchSPXJourney(trackingNumber) {
    try {
        const { data } = await axios.post(
            SPX_API_URL,
            { tracking_id: trackingNumber },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 15000
            }
        );

        if (data.message !== 'success' || !data.data?.sls_tracking_info?.records) {
            return [];
        }

        return data.data.sls_tracking_info.records;
    } catch (error) {
        console.error(`[SPX Journey] ❌ Lỗi ${trackingNumber}: ${error.message}`);
        return [];
    }
}

module.exports = { fetchSPXStatus, fetchSPXJourney };

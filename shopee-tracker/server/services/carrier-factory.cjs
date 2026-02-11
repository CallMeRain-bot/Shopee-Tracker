/**
 * Carrier Factory
 * Xác định đơn vị vận chuyển từ mã vận đơn và lấy service tương ứng
 * 
 * @module services/carrier-factory
 */

const { fetchSPXStatus } = require('./spx.cjs');
const { fetchGHNStatus } = require('./ghn.cjs');

/**
 * Các patterns để detect carrier từ mã vận đơn
 */
const CARRIER_PATTERNS = {
    SPX: /^(SPXVN|VN\d+)/i,      // SPXVN068797458621 hoặc VN + số (quốc tế)
    // GHN là default nếu không match SPX
};

/**
 * Tracking Method codes
 * 0 = Chưa có MVD, gọi Shopee
 * 1 = SPX (gọi API SPX)
 * 2 = GHN (gọi API GHN)
 * 3 = Unsupported carrier (fallback gọi Shopee)
 */
const TRACKING_METHOD = {
    SHOPEE: 0,
    SPX: 1,
    GHN: 2,
    UNSUPPORTED: 3
};

/**
 * Convert carrier name sang tracking_method code
 */
function getTrackingMethodCode(carrier) {
    const map = {
        'SPX': TRACKING_METHOD.SPX,
        'GHN': TRACKING_METHOD.GHN
    };
    return map[carrier] ?? TRACKING_METHOD.SHOPEE;
}

/**
 * Xác định carrier từ mã vận đơn
 * @param {string} trackingNumber - Mã vận đơn
 * @returns {string|null} Carrier code (SPX, GHN) hoặc null nếu không hợp lệ
 */
function detectCarrier(trackingNumber) {
    if (!trackingNumber || trackingNumber === "Không xác định") {
        return null;
    }

    // Nếu là SPX thì return SPX
    if (CARRIER_PATTERNS.SPX.test(trackingNumber)) {
        return 'SPX';
    }

    // Còn lại default là GHN
    return 'GHN';
}

/**
 * Lấy hàm fetch status theo carrier
 * @param {string} carrier - Carrier code (SPX, GHN, ...)
 * @returns {Function|null} Hàm fetch status hoặc null
 */
function getCarrierFetcher(carrier) {
    const fetchers = {
        SPX: fetchSPXStatus,
        GHN: fetchGHNStatus,
    };

    return fetchers[carrier] || null;
}

/**
 * Fetch trạng thái đơn hàng tự động detect carrier
 * @param {string} trackingNumber - Mã vận đơn
 * @returns {Promise<Object>} Parsed tracking status
 */
async function fetchTrackingStatus(trackingNumber) {
    const carrier = detectCarrier(trackingNumber);

    if (!carrier) {
        return {
            success: false,
            trackingNumber,
            carrier: null,
            error: 'Unsupported carrier or invalid tracking number'
        };
    }

    const fetcher = getCarrierFetcher(carrier);
    return await fetcher(trackingNumber);
}

/**
 * Kiểm tra xem mã vận đơn có hợp lệ không (có carrier được hỗ trợ)
 * @param {string} trackingNumber - Mã vận đơn
 * @returns {boolean}
 */
function isValidTrackingNumber(trackingNumber) {
    return detectCarrier(trackingNumber) !== null;
}

module.exports = {
    detectCarrier,
    getCarrierFetcher,
    fetchTrackingStatus,
    isValidTrackingNumber,
    getTrackingMethodCode,
    CARRIER_PATTERNS,
    TRACKING_METHOD
};

/**
 * Cache Module - Quản lý local cache để so sánh orders
 * Lưu order_id + updated_at + status vào file JSON
 * 
 * @module cache
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'orders.json');

/**
 * Đảm bảo thư mục cache tồn tại
 */
function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
}

/**
 * Load cache từ file
 * @returns {Object} Cache data { orderId: { updated_at, status, product, ... } }
 */
export function loadCache() {
    ensureCacheDir();

    if (!fs.existsSync(CACHE_FILE)) {
        return {};
    }

    try {
        const data = fs.readFileSync(CACHE_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        console.error('[Cache] Error loading cache:', e.message);
        return {};
    }
}

/**
 * Lưu cache vào file
 * @param {Object} data - Cache data
 */
export function saveCache(data) {
    ensureCacheDir();

    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error('[Cache] Error saving cache:', e.message);
    }
}

/**
 * Lấy thông tin order từ cache
 * @param {string} orderId 
 * @returns {Object|null} Order data hoặc null nếu không tồn tại
 */
export function getOrder(orderId) {
    const cache = loadCache();
    return cache[orderId] || null;
}

/**
 * Lưu order vào cache
 * @param {string} orderId 
 * @param {Object} data - { updated_at, status, product, quantity, tracking_number }
 */
export function setOrder(orderId, data) {
    const cache = loadCache();
    cache[orderId] = {
        updated_at: data.updated_at,
        status: data.status,
        product: data.product,
        quantity: data.quantity,
        tracking_number: data.tracking_number
    };
    saveCache(cache);
}

/**
 * Xóa order khỏi cache (khi đã giao thành công)
 * @param {string} orderId 
 */
export function deleteOrder(orderId) {
    const cache = loadCache();
    if (cache[orderId]) {
        delete cache[orderId];
        saveCache(cache);
        console.log(`[Cache] Deleted order ${orderId} from cache`);
    }
}

/**
 * Lấy tất cả orders trong cache
 * @returns {Object} All cached orders
 */
export function getAllOrders() {
    return loadCache();
}

const { fetchOrders, fetchOrdersBatch } = require('../services/shopee.cjs');
const { detectCarrier, fetchTrackingStatus, fetchTrackingJourney, getTrackingMethodCode, TRACKING_METHOD } = require('../services/carrier-factory.cjs');
const db = require('../database/db.cjs');
const { sendDeliveredWebhook } = require('../services/webhook.cjs');

// Helper: Timestamp cho log
function ts() {
    return new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}
function log(tag, msg) { console.log(`[${ts()}] [${tag}] ${msg}`); }
function logErr(tag, msg) { console.error(`[${ts()}] [${tag}] ❌ ${msg}`); }

// Helper: Mask cookie for logging
function maskCookie(cookie) {
    if (!cookie) return 'N/A';
    // Lấy SPC_ST nếu có
    const stMatch = cookie.match(/SPC_ST=([^;]+)/);
    if (stMatch) return `ST:${stMatch[1].substring(0, 8)}...`;
    // Lấy SPC_U nếu có
    const uMatch = cookie.match(/SPC_U=([^;]+)/);
    if (uMatch) return `U:${uMatch[1].substring(0, 8)}...`;
    return cookie.substring(0, 10) + '...';
}

// Event emitter để gửi updates realtime (SSE)
let eventListeners = [];

function emitEvent(type, data) {
    eventListeners.forEach(callback => callback({ type, data }));
}

function addListener(callback) {
    eventListeners.push(callback);
    return () => {
        eventListeners = eventListeners.filter(l => l !== callback);
    };
}

/**
 * 1. Check hàng đợi (nếu có hệ thống queue sau này)
 */
async function checkQueue() {
    // Phase 1: Not implemented
}

/**
 * 2. Check tất cả cookie active ĐỂ TÌM MVD MỚI (Method = 0 hoặc đơn mới)
 */
async function checkActive() {
    const activeCookies = await db.getCookies('active');
    const cookiesToProcess = [...activeCookies];

    log('Scheduler', `[1/3] Khởi động Check Shopee API (${cookiesToProcess.length} cookies)`);

    // In danh sách các cookie đang xử lý
    cookiesToProcess.forEach((c, idx) => {
        log('Checker', `   → Cookie #${idx + 1} [ID:${c.id}] [ACT]: ${maskCookie(c.cookie)}`);
    });

    // Thu thập results
    const results = { newMvd: 0, waiting: 0, hasMvd: 0, skip: 0 };

    // Group cookies to check in batch
    const cookieMap = {};
    const cookieIdsToCheck = [];

    for (const cookieRow of cookiesToProcess) {
        const orders = await db.getCachesByCookie(cookieRow.id);
        const methods = [...new Set(orders.map(o => o.tracking_method))];

        // Chỉ gọi TKSieure cho cookie active có đơn method 3 (Unsupported carrier)
        if (cookieRow.status === 'active' && methods.includes(3)) {
            cookieIdsToCheck.push(String(cookieRow.id));
            cookieMap[cookieRow.id] = cookieRow.cookie;
            log('Checker', `   → Cookie #${cookieRow.id} calls [Shopee API]...`);
        } else {
            results.skip++;
        }
    }

    if (cookieIdsToCheck.length > 0) {
        const BATCH_SIZE = 15;
        for (let i = 0; i < cookieIdsToCheck.length; i += BATCH_SIZE) {
            const batch = cookieIdsToCheck.slice(i, i + BATCH_SIZE);
            const cookiesInBatch = batch.map(id => cookieMap[id]);

            try {
                const shopeeOrders = await fetchOrdersBatch(cookiesInBatch);
                const dummyOrdersByCookie = {};
                for (const id of batch) dummyOrdersByCookie[id] = await db.getCachesByCookie(id);

                const batchResults = { updated: [], checked: 0, errors: [] };
                await processShopeeOrders(shopeeOrders, batch, cookieMap, batchResults, dummyOrdersByCookie);



                // Update counts
                results.newMvd += batchResults.updated.filter(r => r.status === 'tracking_found').length;
                results.waiting += batchResults.updated.filter(r => r.status === 'new_order' || r.status === 'status_updated').length;
            } catch (e) {
                logErr('Checker', `Batch error: ${e.message}`);
            }
        }
    }

    // Luôn trả về mảng để scheduler đọc .length hoặc Object chuẩn
    return results;
}

/**
 * 3. Check trạng thái vận chuyển từ GHN/SPX cho các đơn đã có MVD
 */
async function checkExternalTracking() {
    const ordersWithMvd = await db.getOrdersWithTracking();
    log('Scheduler', `[2/3] Check External Tracking (${ordersWithMvd.length} đơn có MVD)`);

    const results = { delivered: 0, in_transit: 0, error: 0 };
    if (ordersWithMvd.length === 0) return results;

    // SPX/GHN limit rate nên dùng tuần tự hoặc chunk nhỏ
    for (const order of ordersWithMvd) {
        try {
            const maskedC = maskCookie(order.cookie_content || ""); // Cần đảm bảo order join với cookie content nếu muốn log xịn
            log('External', `   → Order ${order.tracking_number} calls [${order.carrier || 'SPX'} API]...`);

            const statusData = await fetchTrackingStatus(order.tracking_number);

            if (statusData.success) {
                // Fix: Mapper statusData.isDelivered (từ spx.cjs/ghn.cjs) sang isCompleted
                const isCompleted = statusData.isDelivered || statusData.is_completed;
                const statusName = statusData.currentStatus?.description || statusData.status || "Đang vận chuyển";

                // Update cache
                await db.setCache(order.order_id || order.id, {
                    ...order,
                    status: statusName,
                    status_time: statusData.currentStatus?.timestamp || statusData.status_time,
                    current_location: statusData.currentLocation || statusData.current_location,
                    next_location: statusData.nextLocation || statusData.next_location
                }, order.cookie_id);

                // 🔥 CẬP NHẬT FULL HÀNH TRÌNH (Sử dụng dữ liệu từ statusData vừa fetch xong)
                if (statusData.records && statusData.records.length > 0) {
                    console.log(`[External] 🗺️ Lưu hành trình ${order.tracking_number}: ${statusData.records.length} records → Supabase...`);
                    await db.setTrackingJourney(order.tracking_number, statusData.records);
                }

                if (isCompleted) {
                    log('External', `      ✅ Thành công: Đã giao hàng!`);

                    // Gửi Webhook Notifier
                    await sendDeliveredWebhook({
                        id: order.order_id || order.id,
                        product: order.product,
                        quantity: order.amount,
                        tracking_number: order.tracking_number,
                        status: statusName
                    });

                    // Chuyển vào history và xóa cache
                    await db.markDelivered(order.order_id || order.id, {
                        ...order,
                        status: statusName,
                        delivered_via: 'external_api'
                    });
                    await db.deleteCache(order.order_id || order.id);
                    await db.checkAndDeleteCookieIfEmpty(order.cookie_id);

                    // 🔥 XOÁ HÀNH TRÌNH SAU KHI GIAO THÀNH CÔNG (Theo ý onichan)
                    if (order.tracking_number) {
                        await db.deleteTrackingJourney(order.tracking_number);
                    }

                    results.delivered++;
                    emitEvent('order_completed', { orderId: order.order_id || order.id, trackingNumber: order.tracking_number, deliveredVia: 'external_api' });
                } else {
                    log('External', `      ℹ️ Trạng thái: ${statusName}`);
                    results.in_transit++;
                }
            } else {
                logErr('External', `      ❌ API Error: ${statusData.error}`);
                results.error++;
            }
        } catch (e) {
            logErr('External', `Lỗi Order ${order.order_id || order.id}: ${e.message}`);
            results.error++;
        }
    }

    return results;
}

/**
 * 4. Check từng cookie cụ thể (Khi admin nhấn nút Check)
 */
async function checkSingleCookie(cookieId) {
    const cookieRow = await db.getCookie(cookieId);
    if (!cookieRow) throw new Error('Cookie not found');

    try {
        const shopeeOrders = await fetchOrders(cookieRow.cookie);
        const validOrders = shopeeOrders.filter(o => o.id && String(o.id).length >= 3);

        // Cập nhật database
        for (const order of validOrders) {
            const carrier = detectCarrier(order.tracking_number);
            const method = order.tracking_number && order.tracking_number !== "Không xác định"
                ? getTrackingMethodCode(carrier)
                : 0;

            await db.setCache(order.id, {
                ...order,
                carrier: carrier,
                tracking_method: method
            }, cookieId);
        }

        // Mark cookie as active
        if (cookieRow.status === 'pending') {
            await db.updateCookie(cookieId, { status: 'active' });
        }

        return { success: true, ordersFound: validOrders.length };
    } catch (e) {
        if (e.message === 'COOKIE_EXPIRED_ERROR_19') {
            await db.updateCookie(cookieId, { status: 'disabled' });
        }
        throw e;
    }
}

/**
 * 5. Force check Normal - Gọi Shopee API cho các cookie có đơn chờ MVD (tracking_method = 0)
 *    Khác với checkActive() (scheduled) — hàm này LUÔN gọi API vì do user chủ động trigger.
 */
async function forceCheck() {
    const ordersWaitingTracking = await db.getOrdersWithTrackingZero();
    const results = { checked: 0, updated: [], errors: [] };

    // Group orders by cookie_id
    const ordersByCookie = {};
    for (const order of ordersWaitingTracking) {
        if (!order.cookie_id) continue;
        if (!ordersByCookie[order.cookie_id]) ordersByCookie[order.cookie_id] = [];
        ordersByCookie[order.cookie_id].push(order);
    }

    const activeCookies = await db.getCookies('active');
    const pendingCookies = await db.getCookies('pending');
    const allCookies = [...activeCookies, ...pendingCookies];

    const cookieMap = {};
    for (const c of allCookies) cookieMap[c.id] = c.cookie;

    // Lấy ID của các cookie cần check: (Có đơn Method 0) + (Đang Pending)
    const methodZeroCookieIds = Object.keys(ordersByCookie);
    const pendingCookieIds = pendingCookies.map(c => String(c.id));
    const cookieIdsToCheck = Array.from(new Set([...methodZeroCookieIds, ...pendingCookieIds]));

    if (cookieIdsToCheck.length === 0) {
        log('Force Check', 'No pending cookies or orders waiting for tracking (Method 0).');
        return results;
    }

    log('Force Check', `Calling Shopee API for ${cookieIdsToCheck.length} cookies (Method 0 or Pending)...`);

    const BATCH_SIZE = 15;
    for (let i = 0; i < cookieIdsToCheck.length; i += BATCH_SIZE) {
        const batch = cookieIdsToCheck.slice(i, i + BATCH_SIZE);
        const cookiesInBatch = batch.map(id => cookieMap[id]).filter(Boolean);

        try {
            results.checked += batch.length;
            const shopeeOrders = await fetchOrdersBatch(cookiesInBatch);
            const validOrders = shopeeOrders.filter(o => o.id && String(o.id).length >= 3);
            log('Force Check', `   → API trả về ${shopeeOrders.length} đơn (${validOrders.length} hợp lệ) từ ${batch.length} cookies`);
            const batchOrdersByCookie = {};
            for (const cid of batch) batchOrdersByCookie[cid] = ordersByCookie[cid] || [];
            const beforeUpdated = results.updated.length;
            await processShopeeOrders(shopeeOrders, batch, cookieMap, results, batchOrdersByCookie);
            const newUpdates = results.updated.length - beforeUpdated;
            if (newUpdates > 0) log('Force Check', `   → Cập nhật ${newUpdates} đơn từ batch này`);

            for (const id of batch) {
                const cookieObj = allCookies.find(c => String(c.id) === String(id));
                if (cookieObj && cookieObj.status === 'pending') {
                    await db.updateCookie(id, { status: 'active' });
                }
            }
        } catch (e) {
            if (e.message === 'COOKIE_EXPIRED_ERROR_19') {
                for (const cid of batch) {
                    try {
                        const individual = await fetchOrders(cookieMap[cid]);
                        await processShopeeOrders(individual, [cid], cookieMap, results, { [cid]: ordersByCookie[cid] || [] });
                    } catch (indivErr) {
                        if (indivErr.message === 'COOKIE_EXPIRED_ERROR_19') await handleExpiredCookie(cid, ordersByCookie, results);
                        else results.errors.push({ cookieId: cid, error: indivErr.message });
                    }
                }
            } else {
                batch.forEach(id => results.errors.push({ cookieId: id, error: e.message }));
            }
        }
    }

    const trackingFound = results.updated.filter(r => r.status === 'tracking_found').length;
    const newOrders = results.updated.filter(r => r.status === 'new_order').length;
    const cancelled = results.updated.filter(r => r.status === 'cancelled_removed').length;
    log('Force Check', `Done! Checked: ${results.checked} cookies, Updated: ${results.updated.length} orders (MVD mới: ${trackingFound}, Đơn mới: ${newOrders}, Huỷ: ${cancelled}, Errors: ${results.errors.length})`);
    return results;
}

/**
 * 6. Force check ALL - Gọi Shopee API cho TẤT CẢ cookie active
 */
async function forceCheckAll() {
    const allCachedOrders = await db.getAllActiveOrders();
    const ordersByCookie = {};
    for (const order of allCachedOrders) {
        if (order.cookie_id) {
            if (!ordersByCookie[order.cookie_id]) ordersByCookie[order.cookie_id] = [];
            ordersByCookie[order.cookie_id].push(order);
        }
    }

    const results = { checked: 0, updated: [], cancelled: [], errors: [] };
    const activeCookies = await db.getCookies('active');
    const pendingCookies = await db.getCookies('pending');
    const allCookies = [...activeCookies, ...pendingCookies];

    const cookieMap = {};
    for (const c of allCookies) cookieMap[c.id] = c.cookie;

    const cookieIdsToCheck = allCookies.map(c => String(c.id));
    if (cookieIdsToCheck.length === 0) return results;

    const BATCH_SIZE = 15;
    for (let i = 0; i < cookieIdsToCheck.length; i += BATCH_SIZE) {
        const batch = cookieIdsToCheck.slice(i, i + BATCH_SIZE);
        const cookiesInBatch = batch.map(id => cookieMap[id]).filter(Boolean);

        try {
            results.checked += batch.length;
            const shopeeOrders = await fetchOrdersBatch(cookiesInBatch);
            const batchOrdersByCookie = {};
            for (const cid of batch) batchOrdersByCookie[cid] = ordersByCookie[cid] || [];
            await processShopeeOrders(shopeeOrders, batch, cookieMap, results, batchOrdersByCookie);

            // Tự động kích hoạt cookie nếu đang pending
            for (const id of batch) {
                const cookieObj = allCookies.find(c => String(c.id) === String(id));
                if (cookieObj && cookieObj.status === 'pending') {
                    await db.updateCookie(id, { status: 'active' });
                }
            }
        } catch (e) {
            if (e.message === 'COOKIE_EXPIRED_ERROR_19') {
                for (const cid of batch) {
                    try {
                        const individual = await fetchOrders(cookieMap[cid]);
                        await processShopeeOrders(individual, [cid], cookieMap, results, { [cid]: ordersByCookie[cid] || [] });
                    } catch (indivErr) {
                        if (indivErr.message === 'COOKIE_EXPIRED_ERROR_19') await handleExpiredCookie(cid, ordersByCookie, results);
                        else results.errors.push({ cookieId: cid, error: indivErr.message });
                    }
                }
            } else {
                batch.forEach(id => results.errors.push({ cookieId: id, error: e.message }));
            }
        }
    }

    return results;
}

// ========== HELPER FUNCTIONS ==========

async function processShopeeOrders(shopeeOrders, cookieIdsInBatch, cookieMap, results, ordersByCookie) {
    const validOrders = shopeeOrders.filter(o => o.id && String(o.id).length >= 3);
    const knownOrderToCookie = {};
    for (const cid of cookieIdsInBatch) {
        const orders = ordersByCookie[cid] || [];
        for (const o of orders) knownOrderToCookie[String(o.id)] = cid;
    }

    for (const shopeeOrder of validOrders) {
        if (shopeeOrder.is_cancelled) continue;

        // Ưu tiên gán Cookie dựa trên cookie_index (do shopee.cjs parse được từ HTML)
        let cookieId = null;
        if (shopeeOrder.cookie_index !== undefined) {
            cookieId = cookieIdsInBatch[shopeeOrder.cookie_index - 1];
        }

        // Fallback 1: Dựa trên Order ID đã biết trong DB
        if (!cookieId) {
            cookieId = knownOrderToCookie[String(shopeeOrder.id)];
        }

        // Fallback 2: Dựa trên cache nếu có
        if (!cookieId) {
            const cached = await db.getFullCache(shopeeOrder.id);
            if (cached) cookieId = cached.cookie_id;
        }

        if (!cookieId) continue;

        if (shopeeOrder.is_completed) {
            console.log(`[Force Check] Order ${shopeeOrder.id} is completed via Shopee API`);
            await sendDeliveredWebhook({ id: shopeeOrder.id, product: shopeeOrder.product, quantity: shopeeOrder.amount, tracking_number: shopeeOrder.tracking_number, status: shopeeOrder.status });
            await db.markDelivered(shopeeOrder.id, { ...shopeeOrder, delivered_via: 'shopee_api' });
            await db.deleteCache(shopeeOrder.id);
            await db.checkAndDeleteCookieIfEmpty(cookieId);
            results.updated.push({ orderId: shopeeOrder.id, status: 'delivered' });
            emitEvent('order_completed', { orderId: shopeeOrder.id, trackingNumber: shopeeOrder.tracking_number, deliveredVia: 'shopee_api' });
            continue;
        }

        const cachedOrder = await db.getFullCache(shopeeOrder.id);
        const shopeeHasMvd = shopeeOrder.tracking_number && shopeeOrder.tracking_number !== "Không xác định";

        if (shopeeHasMvd) {
            const carrier = detectCarrier(shopeeOrder.tracking_number);
            const verifyResult = await fetchTrackingStatus(shopeeOrder.tracking_number);
            const trackingMethodCode = (!verifyResult.success && verifyResult.unsupportedCarrier) ? TRACKING_METHOD.UNSUPPORTED : getTrackingMethodCode(carrier);
            await db.setCache(shopeeOrder.id, { ...shopeeOrder, carrier: carrier, tracking_method: trackingMethodCode }, cookieId);
            results.updated.push({ orderId: shopeeOrder.id, trackingNumber: shopeeOrder.tracking_number, status: 'tracking_found', carrier: carrier });
            emitEvent('tracking_number_found', { orderId: shopeeOrder.id, trackingNumber: shopeeOrder.tracking_number, carrier: carrier });
        } else {
            const isNew = !cachedOrder;
            if (isNew || (cachedOrder && cachedOrder.status !== shopeeOrder.status)) {
                await db.setCache(shopeeOrder.id, { ...shopeeOrder, tracking_method: TRACKING_METHOD.SHOPEE }, cookieId);
                results.updated.push({ orderId: shopeeOrder.id, status: isNew ? 'new_order' : 'status_updated', newStatus: shopeeOrder.status });
                emitEvent(isNew ? 'new_order_found' : 'order_updated', { orderId: shopeeOrder.id, order: shopeeOrder });
            }
        }
    }

    for (const cid of cookieIdsInBatch) {
        const cachedInCookie = ordersByCookie[cid] || [];
        for (const cachedOrder of cachedInCookie) {
            const stillExists = validOrders.find(o => String(o.id) === String(cachedOrder.id));
            if (!stillExists) {
                console.log(`[Force Check] Order ${cachedOrder.id} not found in Shopee - possibly cancelled`);
                await db.deleteCache(cachedOrder.id);
                await db.checkAndDeleteCookieIfEmpty(cid);
                results.updated.push({ orderId: cachedOrder.id, status: 'cancelled_removed' });
            }
        }
    }
}

async function handleExpiredCookie(cookieId, ordersByCookie, results) {
    console.log(`[Force Check] Cookie ${cookieId} expired (Error 19) - Disabling and cleaning cache...`);
    await db.updateCookie(cookieId, { status: 'disabled' });
    const ordersToDelete = ordersByCookie[cookieId] || [];
    for (const order of ordersToDelete) await db.deleteCache(order.id);
    results.errors.push({ cookieId, error: 'Cookie Hết Hạn (Error 19)', action: 'disabled_and_cleaned' });
    emitEvent('cookie_expired', { cookieId, reason: 'Error 19 - Cookie Hết Hạn' });
}

async function fixMismatchedMethods() {
    const ordersWithZero = await db.getOrdersWithTrackingZero();
    const brokenOrders = ordersWithZero.filter(o => o.tracking_number && o.tracking_number !== "Không xác định");
    if (brokenOrders.length === 0) return 0;
    log('Fixer', `Tìm thấy ${brokenOrders.length} đơn có MVD nhưng method = 0. Đang fix...`);
    let fixedCount = 0;
    for (const order of brokenOrders) {
        try {
            const carrier = detectCarrier(order.tracking_number);
            const method = getTrackingMethodCode(carrier);
            const fullCache = await db.getFullCache(order.order_id || order.id);
            if (!fullCache) continue;
            await db.setCache(order.order_id || order.id, { ...fullCache, carrier: carrier, tracking_method: method }, order.cookie_id);
            fixedCount++;
            log('Fixer', `✅ Đã fix Order ${order.order_id || order.id}: method 0 → ${method} (${carrier})`);
        } catch (e) { logErr('Fixer', `❌ Lỗi khi fix Order ${order.order_id || order.id}: ${e.message}`); }
    }

    // Cleanup orphan active cookies
    const cleanedCount = await db.cleanupOrphanCookies();
    if (cleanedCount > 0) {
        log('Fixer', `🧹 Đã dọn dẹp ${cleanedCount} cookie active không có đơn.`);
    }

    return fixedCount;
}

module.exports = { checkQueue, checkActive, checkSingleCookie, checkExternalTracking, forceCheck, forceCheckAll, fixMismatchedMethods, addListener, emitEvent };

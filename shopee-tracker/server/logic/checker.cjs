const { fetchOrders } = require('../services/shopee.cjs');
const { detectCarrier, fetchTrackingStatus, getTrackingMethodCode, TRACKING_METHOD } = require('../services/carrier-factory.cjs');
const db = require('../database/db.cjs');
const { sendDeliveredWebhook } = require('../services/webhook.cjs');

// Event emitter để gửi updates realtime (SSE)
let eventListeners = [];

function emitEvent(type, data) {
    eventListeners.forEach(callback => callback({ type, data }));
}

function addListener(callback) {
    eventListeners.push(callback);
    return () => {
        eventListeners = eventListeners.filter(cb => cb !== callback);
    };
}

async function checkQueue() {
    const pendingCookies = await db.getCookies('pending');
    if (pendingCookies.length === 0) return [];

    const results = [];

    for (const cookieRow of pendingCookies) {
        try {
            const orders = await fetchOrders(cookieRow.cookie);
            const validOrders = orders.filter(o => o.id && String(o.id).length >= 3);

            if (validOrders.length === 0) {
                results.push({ cookieId: cookieRow.id, status: 'waiting', message: 'Chưa có đơn' });
                continue;
            }

            await db.updateCookie(cookieRow.id, { status: 'active' });
            results.push({ cookieId: cookieRow.id, status: 'activated', ordersFound: validOrders.length });
            emitEvent('cookie_activated', { cookieId: cookieRow.id, ordersFound: validOrders.length });
        } catch (e) {
            results.push({ cookieId: cookieRow.id, status: 'error', error: e.message });
        }
    }

    return results;
}

async function checkActive() {
    const activeCookies = await db.getCookies('active');
    if (activeCookies.length === 0) return [];

    const results = [];

    for (const cookieRow of activeCookies) {
        try {
            // CHECK: Cookie này đã có orders trong cache chưa?
            const cachedOrders = await db.getCachesByCookie(cookieRow.id);

            // Case 2: Đã có orders -> LUÔN quét Shopee API để cập nhật status mới nhất
            // Không SKIP nữa để đảm bảo phát hiện đơn Giao thành công từ Shopee

            // Case 3: Chưa có orders trong cache HOẶC có orders với tracking_method = 3 (unsupported)
            // → Gọi Shopee API để lấy thông tin mới

            // Chưa có MVD hoặc tracking_method = 0/3 → gọi Shopee API
            const orders = await fetchOrders(cookieRow.cookie);
            const validOrders = orders.filter(o => o.id && String(o.id).length >= 3);

            // Detect cookie die
            const hasValidProduct = validOrders.some(o =>
                o.product &&
                o.product !== "Sản phẩm" &&
                !o.product.startsWith("Sản phẩm -")
            );

            if (validOrders.length > 0 && !hasValidProduct) {
                await db.updateCookie(cookieRow.id, { status: 'disabled' });
                results.push({ cookieId: cookieRow.id, status: 'disabled', reason: 'Cookie die - garbage data' });
                emitEvent('cookie_disabled', { cookieId: cookieRow.id, reason: 'garbage_data' });
                continue;
            }

            if (validOrders.length === 0) {
                results.push({ cookieId: cookieRow.id, status: 'no_orders' });
                continue;
            }

            // Filter orders
            const activeOrders = validOrders.filter(o => !o.is_cancelled);
            const cancelledOrders = validOrders.filter(o => o.is_cancelled);
            const ordersToProcess = activeOrders.length > 0 ? [activeOrders[0]] : []; // Chỉ xử lý đúng 1 đơn đầu tiên

            // Clean cancelled orders from cache
            for (const cancelled of cancelledOrders) {
                const cachedCancelled = await db.getCache(cancelled.id);
                if (cachedCancelled) {
                    await db.deleteCache(cancelled.id);
                }
            }

            for (const order of ordersToProcess) {
                // Kiểm tra order này đã có mvd trong cache chưa
                const cachedOrder = await db.getFullCache(order.id);
                const hasMvdInCache = cachedOrder?.tracking_number &&
                    cachedOrder.tracking_number !== "Không xác định";

                // Kiểm tra đơn đã giao thành công chưa (Để chuyển vào history)
                if (order.is_completed) {
                    console.log(`[Checker] Order ${order.id} is completed via Shopee API`);

                    // Gửi webhook thông báo
                    await sendDeliveredWebhook({
                        id: order.id,
                        product: order.product,
                        quantity: order.amount,
                        tracking_number: order.tracking_number,
                        status: order.status
                    });

                    // Lưu vào history và xóa cache
                    await db.markDelivered(order.id, {
                        ...order,
                        delivered_via: 'shopee_api'
                    });
                    await db.deleteCache(order.id);

                    // Xóa cookie liên quan nếu không còn orders khác
                    if (cookieRow.id) {
                        const remainingOrders = await db.getCachesByCookie(cookieRow.id);
                        if (remainingOrders.length === 0) {
                            await db.deleteCookie(cookieRow.id);
                        }
                    }

                    results.push({
                        cookieId: cookieRow.id,
                        status: 'delivered',
                        orderId: order.id
                    });

                    emitEvent('order_completed', {
                        orderId: order.id,
                        trackingNumber: order.tracking_number,
                        deliveredVia: 'shopee_api'
                    });
                    continue;
                }

                if (hasMvdInCache) {
                    // Đã có mvd → SKIP, sẽ được xử lý bởi checkExternalTracking()
                    results.push({
                        cookieId: cookieRow.id,
                        status: 'has_tracking',
                        orderId: order.id,
                        trackingNumber: cachedOrder.tracking_number
                    });
                    continue;
                }

                // Chưa có mvd trong cache - kiểm tra xem lần này Shopee có trả về mvd không
                const shopeeHasMvd = order.tracking_number &&
                    order.tracking_number !== "Không xác định";

                if (shopeeHasMvd) {
                    // Shopee đã có mvd! Verify bằng API trước khi lưu
                    const carrier = detectCarrier(order.tracking_number);
                    const verifyResult = await fetchTrackingStatus(order.tracking_number);

                    // Nếu API trả về unsupportedCarrier (ví dụ GHN 204) → không phải carrier này
                    if (!verifyResult.success && verifyResult.unsupportedCarrier) {
                        console.log(`[Checker] MVD ${order.tracking_number} không được hỗ trợ bởi ${carrier}, đánh dấu UNSUPPORTED`);

                        // Lưu order với tracking_method = 3 (UNSUPPORTED, fallback gọi Shopee)
                        await db.setCache(order.id, {
                            ...order,
                            status: order.status,
                            tracking_number: order.tracking_number,
                            carrier: null,
                            tracking_method: TRACKING_METHOD.UNSUPPORTED // 3
                        }, cookieRow.id);

                        results.push({
                            cookieId: cookieRow.id,
                            status: 'unsupported_carrier',
                            orderId: order.id,
                            trackingNumber: order.tracking_number,
                            carrier: carrier
                        });
                        continue;
                    }

                    // Carrier hợp lệ! Lưu MVD và tracking_method vào cache
                    const trackingMethodCode = getTrackingMethodCode(carrier);
                    await db.setCache(order.id, {
                        ...order,
                        status: order.status,
                        tracking_number: order.tracking_number,
                        carrier: carrier,
                        tracking_method: trackingMethodCode // 1=SPX, 2=GHN
                    }, cookieRow.id);

                    emitEvent('tracking_number_found', {
                        cookieId: cookieRow.id,
                        orderId: order.id,
                        trackingNumber: order.tracking_number,
                        carrier: carrier
                    });

                    results.push({
                        cookieId: cookieRow.id,
                        status: 'tracking_found',
                        orderId: order.id,
                        trackingNumber: order.tracking_number
                    });
                    continue;
                }

                // Vẫn chưa có mvd - cập nhật trạng thái bình thường (tracking_method = 0)
                const lastStatus = await db.getCache(order.id);
                const isNewState = !lastStatus || lastStatus !== order.status;

                if (isNewState) {
                    await db.setCache(order.id, {
                        ...order,
                        status: order.status,
                        tracking_method: TRACKING_METHOD.SHOPEE // 0
                    }, cookieRow.id);
                    emitEvent('order_updated', { cookieId: cookieRow.id, order });
                }

                results.push({ cookieId: cookieRow.id, status: 'waiting_tracking', order: order.status });
            }
        } catch (e) {
            // Cookie error - disable
            const cachedOrders = await db.getCachesByCookie(cookieRow.id);
            await db.updateCookie(cookieRow.id, { status: 'disabled' });

            results.push({ cookieId: cookieRow.id, status: 'error', error: e.message, lastOrders: cachedOrders });
            emitEvent('cookie_error', { cookieId: cookieRow.id, error: e.message });
        }
    }
    return results;
}

async function checkSingleCookie(cookie) {
    try {
        const orders = await fetchOrders(cookie);
        const validOrders = orders.filter(o => o.id && String(o.id).length >= 3);

        if (validOrders.length === 0 && orders.length > 0) {
            return { valid: false, reason: 'Invalid order IDs' };
        }

        // Check for garbage data
        const hasValidProduct = validOrders.some(o =>
            o.product &&
            o.product !== "Sản phẩm" &&
            !o.product.startsWith("Sản phẩm -")
        );

        if (orders.length > 0 && !hasValidProduct) {
            return { valid: false, reason: 'Cookie die - garbage data' };
        }

        const activeOrders = validOrders.filter(o => !o.is_cancelled);

        return {
            valid: true,
            ordersCount: activeOrders.length > 0 ? 1 : 0,
            orders: activeOrders.length > 0 ? [activeOrders[0]] : []
        };
    } catch (e) {
        return { valid: false, reason: e.message };
    }
}

/**
 * Check orders đã có MVD qua API SPX/GHN
 * Chỉ gọi cho orders đã có tracking_number trong cache
 */
async function checkExternalTracking() {
    const ordersWithTracking = await db.getOrdersWithTracking();
    if (ordersWithTracking.length === 0) return [];

    const results = [];
    console.log(`[External Tracking] Checking ${ordersWithTracking.length} orders with tracking numbers...`);

    for (const order of ordersWithTracking) {
        try {
            // Gọi API SPX/GHN dựa vào carrier
            const trackingResult = await fetchTrackingStatus(order.tracking_number);

            if (!trackingResult.success) {
                results.push({
                    orderId: order.id,
                    trackingNumber: order.tracking_number,
                    status: 'error',
                    error: trackingResult.error
                });
                continue;
            }

            // Check xem đã giao thành công chưa
            if (trackingResult.isDelivered) {
                // Gửi webhook thông báo đến bot TRƯỚC khi xóa cache
                await sendDeliveredWebhook({
                    id: order.id,
                    product: order.product,
                    quantity: order.quantity,
                    tracking_number: order.tracking_number,
                    status: trackingResult.currentStatus.description
                });

                // Đã giao thành công - mark delivered và cleanup
                await db.markDelivered(order.id, {
                    ...order,
                    status: trackingResult.currentStatus.description,
                    delivered_via: trackingResult.carrier
                });
                await db.deleteCache(order.id);

                // Xóa cookie liên quan nếu không còn orders khác
                if (order.cookie_id) {
                    const remainingOrders = await db.getCachesByCookie(order.cookie_id);
                    if (remainingOrders.length === 0) {
                        await db.deleteCookie(order.cookie_id);
                    }
                }

                results.push({
                    orderId: order.id,
                    trackingNumber: order.tracking_number,
                    status: 'delivered',
                    carrier: trackingResult.carrier
                });

                emitEvent('order_completed', {
                    orderId: order.id,
                    trackingNumber: order.tracking_number,
                    carrier: trackingResult.carrier,
                    deliveredVia: 'external_api'
                });

                console.log(`[External Tracking] Order ${order.id} delivered via ${trackingResult.carrier}`);
                continue;
            }

            // Chưa giao - cập nhật trạng thái mới (nếu khác) hoặc location thay đổi
            const newStatus = trackingResult.currentStatus.description;
            const newStatusTime = trackingResult.currentStatus.timestamp; // Unix timestamp từ API
            const newCurrentLocation = trackingResult.currentLocation || null;
            const newNextLocation = trackingResult.nextLocation || null;

            // So sánh với cả undefined và null
            const oldCurrentLocation = order.current_location || null;
            const oldNextLocation = order.next_location || null;

            const statusChanged = order.status !== newStatus;
            const locationChanged = oldCurrentLocation !== newCurrentLocation ||
                oldNextLocation !== newNextLocation;
            const needsStatusTimeBackfill = !order.status_time && newStatusTime; // Backfill nếu chưa có status_time

            // Debug log location
            console.log(`[External Tracking] Order ${order.id}: status=${statusChanged ? 'changed' : 'same'}, location=${locationChanged ? 'changed' : 'same'}, backfill=${needsStatusTimeBackfill}`);
            if (newCurrentLocation || newNextLocation) {
                console.log(`[External Tracking] Locations: current="${newCurrentLocation}", next="${newNextLocation}"`);
            }

            if (statusChanged || locationChanged || needsStatusTimeBackfill) {
                await db.setCache(order.id, {
                    ...order,
                    status: newStatus,
                    status_time: newStatusTime, // Lưu thời gian thực từ API
                    current_location: newCurrentLocation,
                    next_location: newNextLocation
                }, order.cookie_id);

                emitEvent('order_status_updated', {
                    orderId: order.id,
                    trackingNumber: order.tracking_number,
                    carrier: trackingResult.carrier,
                    oldStatus: order.status,
                    newStatus: newStatus,
                    currentLocation: newCurrentLocation,
                    nextLocation: newNextLocation
                });
            }

            results.push({
                orderId: order.id,
                trackingNumber: order.tracking_number,
                status: 'tracking',
                carrier: trackingResult.carrier,
                currentStatus: newStatus
            });

        } catch (e) {
            console.error(`[External Tracking] Error checking ${order.tracking_number}:`, e.message);
            results.push({
                orderId: order.id,
                trackingNumber: order.tracking_number,
                status: 'error',
                error: e.message
            });
        }
    }

    return results;
}

/**
 * Force check - Gọi Shopee API cho các orders có tracking_method = 0
 * Dùng khi user muốn check thủ công những đơn chưa có MVD
 */
async function forceCheck() {
    // Lấy orders có tracking_method = 0 (chờ MVD)
    const ordersWaitingTracking = await db.getOrdersWithTrackingZero();
    if (ordersWaitingTracking.length === 0) {
        return { checked: 0, updated: [], errors: [] };
    }

    const results = {
        checked: 0,
        updated: [],
        errors: []
    };

    // Group orders by cookie_id để gọi Shopee API theo cookie
    const ordersByCookie = {};
    for (const order of ordersWaitingTracking) {
        if (!order.cookie_id) continue;
        if (!ordersByCookie[order.cookie_id]) {
            ordersByCookie[order.cookie_id] = [];
        }
        ordersByCookie[order.cookie_id].push(order);
    }

    console.log(`[Force Check] Found ${ordersWaitingTracking.length} orders with tracking_method = 0`);
    console.log(`[Force Check] Grouped into ${Object.keys(ordersByCookie).length} cookies`);

    // Lấy TẤT CẢ cookies active để quét đơn mới
    const activeCookies = await db.getCookies('active');
    if (activeCookies.length === 0) {
        return { checked: 0, updated: [], errors: [] };
    }

    const cookieMap = {};
    for (const c of activeCookies) {
        cookieMap[c.id] = c.cookie;
    }

    // Đảm bảo tất cả cookie active đều được check, kể cả khi chưa có đơn trong cache
    const cookieIdsToCheck = new Set([
        ...Object.keys(ordersByCookie),
        ...activeCookies.map(c => String(c.id))
    ]);

    for (const cookieId of cookieIdsToCheck) {
        const cookieString = cookieMap[cookieId];
        if (!cookieString) {
            console.log(`[Force Check] Cookie ${cookieId} not found or not active, skipping...`);
            continue;
        }

        try {
            results.checked++;
            const shopeeOrders = await fetchOrders(cookieString);
            const validOrders = shopeeOrders.filter(o => o.id && String(o.id).length >= 3);

            // 1. Cập nhật hoặc thêm đơn mới từ Shopee (GIỚI HẠN 1 ĐƠN)
            const ordersToProcess = validOrders.length > 0 ? [validOrders[0]] : [];

            for (const shopeeOrder of ordersToProcess) {
                if (shopeeOrder.is_cancelled) continue;

                // 0. Kiểm tra nếu đơn đã giao thành công (Chuyển vào history)
                if (shopeeOrder.is_completed) {
                    console.log(`[Force Check] Order ${shopeeOrder.id} is completed via Shopee API`);

                    // Gửi webhook
                    await sendDeliveredWebhook({
                        id: shopeeOrder.id,
                        product: shopeeOrder.product,
                        quantity: shopeeOrder.amount,
                        tracking_number: shopeeOrder.tracking_number,
                        status: shopeeOrder.status
                    });

                    // Lưu vào history và xóa cache
                    await db.markDelivered(shopeeOrder.id, {
                        ...shopeeOrder,
                        delivered_via: 'shopee_api'
                    });
                    await db.deleteCache(shopeeOrder.id);

                    // Xóa cookie nếu không còn đơn nào khác
                    if (cookieId) {
                        const remainingOrders = await db.getCachesByCookie(cookieId);
                        if (remainingOrders.length === 0) {
                            await db.deleteCookie(cookieId);
                        }
                    }

                    results.updated.push({
                        orderId: shopeeOrder.id,
                        status: 'delivered'
                    });

                    emitEvent('order_completed', {
                        orderId: shopeeOrder.id,
                        trackingNumber: shopeeOrder.tracking_number,
                        deliveredVia: 'shopee_api'
                    });
                    continue;
                }

                // Tìm xem đơn này đã có trong cache chưa
                const cachedOrder = await db.getFullCache(shopeeOrder.id);

                // Kiểm tra xem Shopee đã có MVD chưa
                const shopeeHasMvd = shopeeOrder.tracking_number &&
                    shopeeOrder.tracking_number !== "Không xác định";

                if (shopeeHasMvd) {
                    // Có MVD mới! Verify bằng API carrier
                    const carrier = detectCarrier(shopeeOrder.tracking_number);
                    const verifyResult = await fetchTrackingStatus(shopeeOrder.tracking_number);

                    if (!verifyResult.success && verifyResult.unsupportedCarrier) {
                        // Carrier không hỗ trợ → tracking_method = 3
                        await db.setCache(shopeeOrder.id, {
                            ...shopeeOrder,
                            carrier: null,
                            tracking_method: TRACKING_METHOD.UNSUPPORTED // 3
                        }, cookieId);

                        results.updated.push({
                            orderId: shopeeOrder.id,
                            trackingNumber: shopeeOrder.tracking_number,
                            status: 'unsupported_carrier',
                            carrier: carrier
                        });

                        emitEvent('order_updated', {
                            orderId: shopeeOrder.id,
                            trackingNumber: shopeeOrder.tracking_number,
                            carrier: null
                        });
                    } else {
                        // Carrier hợp lệ! Lưu MVD
                        const trackingMethodCode = getTrackingMethodCode(carrier);
                        await db.setCache(shopeeOrder.id, {
                            ...shopeeOrder,
                            carrier: carrier,
                            tracking_method: trackingMethodCode // 1=SPX, 2=GHN
                        }, cookieId);

                        results.updated.push({
                            orderId: shopeeOrder.id,
                            trackingNumber: shopeeOrder.tracking_number,
                            status: cachedOrder ? 'tracking_found' : 'new_order_with_tracking',
                            carrier: carrier
                        });

                        emitEvent('tracking_number_found', {
                            orderId: shopeeOrder.id,
                            trackingNumber: shopeeOrder.tracking_number,
                            carrier: carrier
                        });

                        console.log(`[Force Check] Order ${shopeeOrder.id} - Found MVD: ${shopeeOrder.tracking_number} (${carrier})`);
                    }
                } else {
                    // Vẫn chưa có MVD - cập nhật status nếu thay đổi hoặc thêm mới
                    const isNew = !cachedOrder;
                    const statusChanged = cachedOrder && cachedOrder.status !== shopeeOrder.status;

                    if (isNew || statusChanged) {
                        await db.setCache(shopeeOrder.id, {
                            ...shopeeOrder,
                            tracking_method: TRACKING_METHOD.SHOPEE // 0
                        }, cookieId);

                        results.updated.push({
                            orderId: shopeeOrder.id,
                            status: isNew ? 'new_order' : 'status_updated',
                            oldStatus: cachedOrder?.status,
                            newStatus: shopeeOrder.status
                        });

                        emitEvent(isNew ? 'new_order_found' : 'order_updated', { orderId: shopeeOrder.id, order: shopeeOrder });
                        console.log(`[Force Check] Order ${shopeeOrder.id} - ${isNew ? 'New Order' : 'Status Updated'}: ${shopeeOrder.status}`);
                    }
                }
            }

            // 2. Kiểm tra xem có đơn nào trong cache bị huỷ không (không có trong response shopee)
            if (ordersByCookie[cookieId]) {
                for (const cachedOrder of ordersByCookie[cookieId]) {
                    const stillExists = validOrders.find(o => String(o.id) === String(cachedOrder.id));
                    if (!stillExists) {
                        console.log(`[Force Check] Order ${cachedOrder.id} not found in Shopee - possibly cancelled`);
                        await db.deleteCache(cachedOrder.id);
                        results.updated.push({
                            orderId: cachedOrder.id,
                            status: 'cancelled_removed'
                        });
                    }
                }
            }

        } catch (e) {
            console.error(`[Force Check] Error for cookie ${cookieId}:`, e.message);

            // Xử lý Error 19 - Cookie Hết Hạn
            if (e.message === 'COOKIE_EXPIRED_ERROR_19') {
                console.log(`[Force Check] Cookie ${cookieId} expired (Error 19) - Disabling and cleaning cache...`);

                // Disable cookie
                await db.updateCookie(cookieId, { status: 'disabled' });

                // Xoá cache của các orders thuộc cookie này
                const ordersToDelete = ordersByCookie[cookieId] || [];
                for (const order of ordersToDelete) {
                    await db.deleteCache(order.id);
                    console.log(`[Force Check] Deleted cache for order ${order.id}`);
                }

                results.errors.push({
                    cookieId: cookieId,
                    error: 'Cookie Hết Hạn (Error 19)',
                    action: 'disabled_and_cleaned',
                    deletedOrders: ordersToDelete.length
                });

                emitEvent('cookie_expired', {
                    cookieId: cookieId,
                    reason: 'Error 19 - Cookie Hết Hạn',
                    deletedOrders: ordersToDelete.length
                });
            } else {
                results.errors.push({
                    cookieId: cookieId,
                    error: e.message
                });
            }
        }
    }

    console.log(`[Force Check] Done! Checked: ${results.checked} cookies, Updated: ${results.updated.length} orders`);
    return results;
}

/**
 * Force check ALL - Gọi Shopee API cho TẤT CẢ orders trong cache
 * Dùng để phát hiện đơn huỷ, cookie khoá
 */
async function forceCheckAll() {
    // Lấy TẤT CẢ orders trong cache (không lọc tracking_method)
    const allCachedOrders = await db.getAllActiveOrders();
    if (allCachedOrders.length === 0) {
        return { checked: 0, updated: [], cancelled: [], errors: [] };
    }

    const results = {
        checked: 0,
        updated: [],
        cancelled: [],
        errors: []
    };

    // Group orders by cookie_id
    const ordersByCookie = {};
    for (const order of allCachedOrders) {
        if (!order.cookie_id) continue;
        if (!ordersByCookie[order.cookie_id]) {
            ordersByCookie[order.cookie_id] = [];
        }
        ordersByCookie[order.cookie_id].push(order);
    }

    console.log(`[Force Check ALL] Found ${allCachedOrders.length} orders in cache`);
    console.log(`[Force Check ALL] Grouped into ${Object.keys(ordersByCookie).length} cookies`);

    // Lấy cookies active để có cookie string
    const activeCookies = await db.getCookies('active');
    const cookieMap = {};
    for (const c of activeCookies) {
        cookieMap[c.id] = c.cookie;
    }

    for (const cookieId of Object.keys(ordersByCookie)) {
        const cookieString = cookieMap[cookieId];
        if (!cookieString) {
            console.log(`[Force Check ALL] Cookie ${cookieId} not found or not active, skipping...`);
            continue;
        }

        try {
            results.checked++;
            const shopeeOrders = await fetchOrders(cookieString);
            const validOrders = shopeeOrders.filter(o => o.id && String(o.id).length >= 3);

            // Match orders từ Shopee với orders trong cache
            for (const cachedOrder of ordersByCookie[cookieId]) {
                const shopeeOrder = validOrders.find(o => String(o.id) === String(cachedOrder.id));

                if (!shopeeOrder) {
                    // Đơn không còn trong Shopee response => có thể đã huỷ
                    console.log(`[Force Check ALL] Order ${cachedOrder.id} not found in Shopee - possibly cancelled`);
                    results.cancelled.push({
                        orderId: cachedOrder.id,
                        reason: 'Không tìm thấy đơn trong Shopee response'
                    });
                    continue;
                }

                // Nếu đơn bị huỷ
                if (shopeeOrder.is_cancelled) {
                    console.log(`[Force Check ALL] Order ${cachedOrder.id} is cancelled`);
                    await db.deleteCache(cachedOrder.id);
                    results.cancelled.push({
                        orderId: cachedOrder.id,
                        reason: 'Đơn đã bị huỷ'
                    });
                    continue;
                }

                // Update status nếu thay đổi
                if (cachedOrder.status !== shopeeOrder.status) {
                    await db.setCache(cachedOrder.id, {
                        ...cachedOrder,
                        ...shopeeOrder,
                        status: shopeeOrder.status
                    }, cookieId);

                    results.updated.push({
                        orderId: cachedOrder.id,
                        oldStatus: cachedOrder.status,
                        newStatus: shopeeOrder.status
                    });
                    console.log(`[Force Check ALL] Order ${cachedOrder.id} status: ${cachedOrder.status} → ${shopeeOrder.status}`);
                }
            }

        } catch (e) {
            console.error(`[Force Check ALL] Error for cookie ${cookieId}:`, e.message);

            // Xử lý Error 19 - Cookie Hết Hạn
            if (e.message === 'COOKIE_EXPIRED_ERROR_19') {
                console.log(`[Force Check ALL] Cookie ${cookieId} expired (Error 19) - Disabling and cleaning cache...`);

                await db.updateCookie(cookieId, { status: 'disabled' });

                const ordersToDelete = ordersByCookie[cookieId] || [];
                for (const order of ordersToDelete) {
                    await db.deleteCache(order.id);
                }

                results.errors.push({
                    cookieId: cookieId,
                    error: 'Cookie Hết Hạn (Error 19)',
                    action: 'disabled_and_cleaned',
                    deletedOrders: ordersToDelete.length
                });

                emitEvent('cookie_expired', {
                    cookieId: cookieId,
                    reason: 'Error 19 - Cookie Hết Hạn',
                    deletedOrders: ordersToDelete.length
                });
            } else {
                results.errors.push({
                    cookieId: cookieId,
                    error: e.message
                });
            }
        }
    }

    console.log(`[Force Check ALL] Done! Checked: ${results.checked} cookies, Updated: ${results.updated.length}, Cancelled: ${results.cancelled.length}`);
    return results;
}

module.exports = { checkQueue, checkActive, checkSingleCookie, checkExternalTracking, forceCheck, forceCheckAll, addListener, emitEvent };


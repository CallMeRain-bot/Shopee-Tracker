const express = require('express');
const router = express.Router();
const db = require('../database/db.cjs');
const { checkActive, forceCheck, forceCheckAll } = require('../logic/checker.cjs');
const { fetchOrders } = require('../services/shopee.cjs');
const { detectCarrier, getTrackingMethodCode } = require('../services/carrier-factory.cjs');
const { sendDeliveredWebhook } = require('../services/webhook.cjs');

// GET active orders (from cache)
router.get('/active', async (req, res) => {
    try {
        const orders = await db.getAllActiveOrders();
        res.json(orders);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET delivery history with cursor-based pagination
router.get('/history', async (req, res) => {
    try {
        const cursor = req.query.cursor || null;
        const limit = parseInt(req.query.limit) || 30;

        const [result, total] = await Promise.all([
            db.getDeliveredCursor(cursor, limit),
            db.countDelivered()
        ]);

        res.json({
            orders: result.orders,
            nextCursor: result.nextCursor,
            hasMore: result.hasMore,
            total
        });
    } catch (e) {
        const status = e.message?.includes('timed out') ? 504 : 500;
        res.status(status).json({ error: e.message });
    }
});

// GET tracking journey for a specific tracking number
router.get('/tracking/:trackingNumber', async (req, res) => {
    try {
        const { trackingNumber } = req.params;
        const journey = await db.getTrackingJourney(trackingNumber);
        if (journey) {
            res.json(journey);
        } else {
            res.status(404).json({ error: 'Tracking data not found' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST force check all (trigger checker)
router.post('/check-all', async (req, res) => {
    try {
        const activeResults = await checkActive();

        res.json({
            active: activeResults
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST check single order - gọi Shopee API để check đơn hàng live/die
router.post('/:orderId/check', async (req, res) => {
    try {
        const { orderId } = req.params;
        console.log(`[API] Check single order: ${orderId}`);

        const order = await db.getFullCache(orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found in cache' });
        }

        // Lấy cookie content để gọi Shopee API
        const cookieRow = await db.getCookie(order.cookie_id);
        if (!cookieRow || !cookieRow.cookie) {
            return res.json({
                success: false,
                status: 'no_cookie',
                message: 'Cookie không tồn tại hoặc đã bị xoá'
            });
        }

        // Gọi Shopee API với cookie của đơn này
        const shopeeOrders = await fetchOrders(cookieRow.cookie);
        const validOrders = shopeeOrders.filter(o => o.id && String(o.id).length >= 3);

        console.log(`[API] Shopee trả về ${validOrders.length} đơn cho cookie #${order.cookie_id}`);

        // Tìm đơn trong kết quả Shopee
        const found = validOrders.find(o => String(o.id) === String(orderId));

        if (!found) {
            // Đơn không còn trên Shopee → die/huỷ
            await db.deleteCache(orderId);
            await db.checkAndDeleteCookieIfEmpty(order.cookie_id);

            return res.json({
                success: true,
                status: 'cancelled',
                message: '❌ Đơn hàng đã bị huỷ hoặc không còn tồn tại trên Shopee'
            });
        }

        // Đơn vẫn live
        if (found.is_cancelled) {
            await db.deleteCache(orderId);
            await db.checkAndDeleteCookieIfEmpty(order.cookie_id);

            return res.json({
                success: true,
                status: 'cancelled',
                message: '❌ Đơn hàng bị huỷ'
            });
        }

        if (found.is_completed) {
            await sendDeliveredWebhook({
                id: orderId,
                product: found.product,
                quantity: found.amount,
                tracking_number: found.tracking_number,
                status: found.status
            });
            await db.markDelivered(orderId, { ...found, delivered_via: 'manual_check' });
            await db.deleteCache(orderId);
            await db.checkAndDeleteCookieIfEmpty(order.cookie_id);

            return res.json({
                success: true,
                status: 'delivered',
                message: `✅ Đã giao hàng! (${found.status})`
            });
        }

        // Đơn vẫn live + đang giao → cập nhật status mới nhất
        const shopeeHasMvd = found.tracking_number && found.tracking_number !== 'Không xác định';
        if (shopeeHasMvd) {
            const carrier = detectCarrier(found.tracking_number);
            const method = getTrackingMethodCode(carrier);
            await db.setCache(orderId, { ...found, carrier, tracking_method: method }, order.cookie_id);
        } else {
            await db.setCache(orderId, { ...found, tracking_method: 0 }, order.cookie_id);
        }

        res.json({
            success: true,
            status: 'active',
            message: `📦 Đơn hàng vẫn live! Trạng thái: ${found.status}`,
            orderStatus: found.status,
            trackingNumber: found.tracking_number
        });
    } catch (e) {
        if (e.message === 'COOKIE_EXPIRED_ERROR_19') {
            return res.json({
                success: false,
                status: 'cookie_expired',
                message: '🍪 Cookie đã hết hạn hoặc bị khoá'
            });
        }
        console.error(`[API] Check order error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

// POST force check - gọi Shopee API cho tất cả cookies để phát hiện đơn huỷ
// mode: 'normal' (default) - chỉ check orders có tracking_method=0
// mode: 'all' - check tất cả orders để phát hiện đơn huỷ/cookie khoá
router.post('/force-check', async (req, res) => {
    try {
        const mode = req.query.mode || req.body.mode || 'normal';
        console.log(`[API] Force check with mode: ${mode}`);

        let results;
        if (mode === 'all') {
            results = await forceCheckAll();
        } else {
            results = await forceCheck();
        }

        res.json(results);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PUT update delivered order info
router.put('/history/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const updateData = req.body;

        if (!orderId || !updateData) {
            return res.status(400).json({ error: 'Missing orderId or update data' });
        }

        const success = await db.updateDelivered(orderId, updateData);
        if (success) {
            res.json({ success: true, message: 'Order updated' });
        } else {
            res.status(404).json({ error: 'Order not found or update failed' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE delivered order
router.delete('/history/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const success = await db.deleteDelivered(orderId);
        if (success) {
            res.json({ success: true, message: 'Order deleted' });
        } else {
            res.status(404).json({ error: 'Order not found or delete failed' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;

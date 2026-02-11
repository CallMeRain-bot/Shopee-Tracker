const express = require('express');
const router = express.Router();
const db = require('../database/db.cjs');
const { checkActive, checkQueue, forceCheck, forceCheckAll } = require('../logic/checker.cjs');

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

// POST force check all (trigger checker)
router.post('/check-all', async (req, res) => {
    try {
        const [queueResults, activeResults] = await Promise.all([
            checkQueue(),
            checkActive()
        ]);

        res.json({
            queue: queueResults,
            active: activeResults
        });
    } catch (e) {
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

/**
 * Webhook Routes - Nhận webhook từ shopee-tracker web
 * 
 * @module webhook
 */

import express from 'express';
import { getOrder, setOrder, deleteOrder } from './cache.js';
import {
    sendNewOrderNotification,
    sendStatusUpdateNotification,
    sendDeliveredNotification
} from './telegram.js';

const router = express.Router();

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

/**
 * Middleware verify webhook secret (optional)
 */
function verifyWebhook(req, res, next) {
    if (WEBHOOK_SECRET) {
        const secret = req.headers['x-webhook-secret'];
        if (secret !== WEBHOOK_SECRET) {
            console.warn('[Webhook] Invalid secret from:', req.ip);
            return res.status(401).json({ error: 'Invalid webhook secret' });
        }
    }
    next();
}

/**
 * POST /webhook/orders
 * Nhận danh sách orders từ web, so sánh và gửi thông báo
 * 
 * Body: { orders: [{ id, product, quantity, tracking_number, status, updated_at }, ...] }
 */
router.post('/orders', verifyWebhook, async (req, res) => {
    try {
        const { orders } = req.body;

        if (!orders || !Array.isArray(orders)) {
            return res.status(400).json({ error: 'Invalid orders data' });
        }

        console.log(`[Webhook] Received ${orders.length} orders`);

        let newCount = 0;
        let updateCount = 0;
        let skipCount = 0;

        for (const order of orders) {
            if (!order.id) continue;

            const cached = getOrder(order.id);

            // Debug: log location data
            if (order.current_location || order.next_location) {
                console.log(`[Webhook] Order ${order.id} locations: current=${order.current_location}, next=${order.next_location}`);
            }

            if (!cached) {
                // Đơn mới hoàn toàn
                console.log(`[Webhook] New order detected: ${order.id}`);
                await sendNewOrderNotification(order);
                setOrder(order.id, order);
                newCount++;
            } else if (cached.status !== order.status) {
                // Trạng thái đơn hàng thay đổi
                console.log(`[Webhook] Order updated: ${order.id}`);
                await sendStatusUpdateNotification(order);
                setOrder(order.id, order);
                updateCount++;
            } else {
                // Không có gì thay đổi
                skipCount++;
            }
        }

        console.log(`[Webhook] Processed: ${newCount} new, ${updateCount} updated, ${skipCount} skipped`);

        res.json({
            success: true,
            processed: { new: newCount, updated: updateCount, skipped: skipCount }
        });

    } catch (e) {
        console.error('[Webhook] Error processing orders:', e.message);
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /webhook/delivered
 * Nhận thông báo đơn giao thành công
 * 
 * Body: { order: { id, product, quantity, tracking_number, status } }
 */
router.post('/delivered', verifyWebhook, async (req, res) => {
    try {
        const { order } = req.body;

        if (!order || !order.id) {
            return res.status(400).json({ error: 'Invalid order data' });
        }

        console.log(`[Webhook] Order delivered: ${order.id}`);

        // Gửi thông báo
        await sendDeliveredNotification(order);

        // Xóa khỏi cache
        deleteOrder(order.id);

        res.json({ success: true, orderId: order.id });

    } catch (e) {
        console.error('[Webhook] Error processing delivered:', e.message);
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /webhook/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

export default router;

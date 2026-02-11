/**
 * Webhook Service - Gửi webhook đến Notifier Bot
 * 
 * @module services/webhook
 */

const WEBHOOK_BOT_URL = process.env.WEBHOOK_BOT_URL || 'http://localhost:3002';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

/**
 * Gửi danh sách orders đến bot
 * @param {Array} orders - Danh sách orders từ cache
 */
async function sendOrdersWebhook(orders) {
    if (!orders || orders.length === 0) {
        console.log('[Webhook] No orders to send');
        return;
    }

    try {
        const response = await fetch(`${WEBHOOK_BOT_URL}/webhook/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Secret': WEBHOOK_SECRET
            },
            body: JSON.stringify({ orders })
        });

        const result = await response.json();

        if (response.ok) {
            console.log(`[Webhook] Sent ${orders.length} orders - Result:`, result.processed);
        } else {
            console.error('[Webhook] Error sending orders:', result.error);
        }
    } catch (e) {
        console.error('[Webhook] Failed to send orders webhook:', e.message);
    }
}

/**
 * Gửi thông báo đơn giao thành công đến bot
 * @param {Object} order - Order data
 */
async function sendDeliveredWebhook(order) {
    if (!order) {
        console.log('[Webhook] No order to send');
        return;
    }

    try {
        const response = await fetch(`${WEBHOOK_BOT_URL}/webhook/delivered`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Secret': WEBHOOK_SECRET
            },
            body: JSON.stringify({ order })
        });

        const result = await response.json();

        if (response.ok) {
            console.log(`[Webhook] Sent delivered notification for order ${order.id}`);
        } else {
            console.error('[Webhook] Error sending delivered:', result.error);
        }
    } catch (e) {
        console.error('[Webhook] Failed to send delivered webhook:', e.message);
    }
}

module.exports = { sendOrdersWebhook, sendDeliveredWebhook };

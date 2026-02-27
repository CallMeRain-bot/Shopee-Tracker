const express = require('express');
const router = express.Router();
const db = require('../database/db.cjs');
const { emitEvent } = require('../logic/checker.cjs');
const { fetchOrders } = require('../services/shopee.cjs');
const { detectCarrier, getTrackingMethodCode } = require('../services/carrier-factory.cjs');

// GET all cookies
router.get('/', async (req, res) => {
    try {
        const cookies = await db.getAllCookies();
        res.json(cookies);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET cookies by status
router.get('/status/:status', async (req, res) => {
    try {
        const cookies = await db.getCookies(req.params.status);
        res.json(cookies);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Input validation helper
const validateCookieInput = (cookie) => {
    if (!cookie || typeof cookie !== 'string') {
        return { valid: false, error: 'Cookie is required and must be a string' };
    }
    // Trim and check length
    const trimmed = cookie.trim();
    if (trimmed.length < 10) {
        return { valid: false, error: 'Cookie too short' };
    }
    if (trimmed.length > 5000) {
        return { valid: false, error: 'Cookie too long (max 5000 chars)' };
    }
    // Check for potential injection patterns
    const dangerousPatterns = [/<script/i, /javascript:/i, /data:/i, /vbscript:/i];
    for (const pattern of dangerousPatterns) {
        if (pattern.test(trimmed)) {
            return { valid: false, error: 'Invalid cookie format' };
        }
    }
    return { valid: true, value: trimmed };
};

// POST add new cookie
router.post('/', async (req, res) => {
    try {
        const { cookie } = req.body;

        // Validate input
        const validation = validateCookieInput(cookie);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }
        const validatedCookie = validation.value;

        const id = await db.addCookie(validatedCookie, 'pending');
        res.status(201).json({ id, status: 'pending' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE cookie
router.delete('/:id', async (req, res) => {
    try {
        await db.deleteCookie(parseInt(req.params.id));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PATCH update cookie (status and/or cookie content)
router.patch('/:id', async (req, res) => {
    try {
        const { status, cookie } = req.body;
        const updates = {};

        if (status) updates.status = status;

        if (cookie) {
            const validation = validateCookieInput(cookie);
            if (!validation.valid) {
                return res.status(400).json({ error: validation.error });
            }
            updates.cookie = validation.value;
            updates.status = 'pending';
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No update fields provided' });
        }

        await db.updateCookie(parseInt(req.params.id), updates);
        res.json({ success: true, status: updates.status || 'unchanged' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST force check a cookie (also activates pending cookies)
router.post('/:id/check', async (req, res) => {
    try {
        const cookies = await db.getAllCookies();
        const cookieRow = cookies.find(c => c.id === parseInt(req.params.id));

        if (!cookieRow) return res.status(404).json({ error: 'Cookie not found' });

        const orders = await fetchOrders(cookieRow.cookie);
        const validOrders = orders.filter(o => o.id && String(o.id).length >= 3);
        const activeOrders = validOrders.filter(o => !o.is_cancelled && !o.is_completed);
        const completedOrders = validOrders.filter(o => o.is_completed);
        const cancelledOrders = validOrders.filter(o => o.is_cancelled);

        // Process completed orders: move to history and remove from cache
        for (const order of completedOrders) {
            await db.markDelivered(order.id, { ...order, delivered_via: 'manual_check' });
            await db.deleteCache(order.id);
        }

        // Process cancelled orders: remove from cache
        for (const order of cancelledOrders) {
            await db.deleteCache(order.id);
        }

        // If cookie is pending, decide whether to activate or delete/notify
        if (cookieRow.status === 'pending') {
            if (activeOrders.length > 0) {
                const firstOrder = activeOrders[0];
                const carrier = detectCarrier(firstOrder.tracking_number);
                const trackingMethod = getTrackingMethodCode(carrier);

                await db.setCache(firstOrder.id, {
                    ...firstOrder,
                    carrier: carrier,
                    tracking_method: trackingMethod
                }, cookieRow.id);

                await db.updateCookie(cookieRow.id, { status: 'active' });
                emitEvent('cookie_activated', { cookieId: cookieRow.id, ordersFound: activeOrders.length });

                return res.json({
                    cookieId: cookieRow.id,
                    status: 'active',
                    activated: true,
                    ordersCount: activeOrders.length,
                    completedCount: completedOrders.length,
                    cancelledCount: cancelledOrders.length,
                    orders: activeOrders
                });
            } else if (completedOrders.length > 0 || cancelledOrders.length > 0) {
                // No active orders, but handled completed/cancelled ones. Clean up cookie if needed.
                await db.checkAndDeleteCookieIfEmpty(cookieRow.id);
                return res.json({
                    cookieId: cookieRow.id,
                    status: 'deleted_empty',
                    activated: false,
                    ordersCount: 0,
                    completedCount: completedOrders.length,
                    cancelledCount: cancelledOrders.length,
                    orders: []
                });
            }
        }

        res.json({
            cookieId: cookieRow.id,
            status: cookieRow.status,
            ordersCount: activeOrders.length,
            completedCount: completedOrders.length,
            cancelledCount: cancelledOrders.length,
            orders: activeOrders
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;

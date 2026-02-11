const express = require('express');
const router = express.Router();
const db = require('../database/db.cjs');
const { checkSingleCookie } = require('../logic/checker.cjs');
const { fetchOrders } = require('../services/shopee.cjs');

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
        const { cookie, checkNow = true } = req.body;

        // Validate input
        const validation = validateCookieInput(cookie);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }
        const validatedCookie = validation.value;

        if (checkNow) {
            // Check cookie validity first
            const checkResult = await checkSingleCookie(validatedCookie);

            if (!checkResult.valid) {
                const id = await db.addCookie(validatedCookie, 'disabled');
                return res.status(201).json({
                    id,
                    status: 'disabled',
                    reason: checkResult.reason
                });
            }

            const id = await db.addCookie(validatedCookie, 'active');
            return res.status(201).json({
                id,
                status: 'active',
                ordersCount: checkResult.ordersCount,
                orders: checkResult.orders
            });
        }

        // Add to queue without checking
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

// PATCH update cookie status
router.patch('/:id', async (req, res) => {
    try {
        const { status } = req.body;
        if (!status) return res.status(400).json({ error: 'Status is required' });

        await db.updateCookie(parseInt(req.params.id), { status });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST force check a cookie
router.post('/:id/check', async (req, res) => {
    try {
        const cookies = await db.getAllCookies();
        const cookieRow = cookies.find(c => c.id === parseInt(req.params.id));

        if (!cookieRow) return res.status(404).json({ error: 'Cookie not found' });

        const orders = await fetchOrders(cookieRow.cookie);
        const validOrders = orders.filter(o => o.id && String(o.id).length >= 3);
        const activeOrders = validOrders.filter(o => !o.is_cancelled && !o.is_completed);

        res.json({
            cookieId: cookieRow.id,
            status: cookieRow.status,
            ordersCount: activeOrders.length > 0 ? 1 : 0,
            orders: activeOrders.length > 0 ? [activeOrders[0]] : []
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;

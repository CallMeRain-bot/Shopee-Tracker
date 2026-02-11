const express = require('express');
const router = express.Router();
const db = require('../database/db.cjs');

// GET stats
router.get('/', async (req, res) => {
    try {
        const stats = await db.getStats();
        res.json(stats);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;

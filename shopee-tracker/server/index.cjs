const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const cookiesRoute = require('./routes/cookies.route.cjs');
const ordersRoute = require('./routes/orders.route.cjs');
const statsRoute = require('./routes/stats.route.cjs');
const { addListener } = require('./logic/checker.cjs');
const { startScheduler } = require('./logic/scheduler.cjs');
const { verifyToken } = require('./middleware/auth.middleware.cjs');
const { apiRateLimiter } = require('./middleware/rateLimit.middleware.cjs');

const app = express();
const PORT = process.env.PORT || 3001;

// Allowed origins for CORS - restrict to your domains
const ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:3001',
    'http://20.189.121.4',
    'https://20.189.121.4',
    'https://huu.ddns.net',
    'http://huu.ddns.net',
];

// Security Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // SPA needs inline scripts
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'", "https://ripwdnrzknhltpkzewke.supabase.co", "wss:"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (same-origin, server-side, static files)
        if (!origin) {
            return callback(null, true);
        }
        // Check cross-origin requests against whitelist
        if (ALLOWED_ORIGINS.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));
app.use(express.json());

// Apply rate limiting to all API routes
app.use('/api', apiRateLimiter);

// Protected API Routes - require authentication
app.use('/api/cookies', verifyToken, cookiesRoute);
app.use('/api/orders', verifyToken, ordersRoute);
app.use('/api/stats', verifyToken, statsRoute);

// SSE endpoint for real-time updates - NOW WITH AUTH
app.get('/api/events', verifyToken, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const removeListener = addListener((event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    req.on('close', () => {
        removeListener();
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve static frontend files (production)
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// SPA fallback - serve index.html for all non-API routes
app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(distPath, 'index.html'));
    } else {
        next();
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 API available at http://localhost:${PORT}/api`);
    console.log(`🌐 Web UI at http://localhost:${PORT}`);

    // Start scheduler for periodic order checks
    startScheduler();
});

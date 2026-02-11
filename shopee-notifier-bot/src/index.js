/**
 * Shopee Notifier Bot - Entry Point
 * Express server nhận webhook từ shopee-tracker
 * 
 * @module index
 */

import express from 'express';
import dotenv from 'dotenv';
import webhookRoutes from './webhook.js';

// Load env trước khi import telegram (cần BOT_TOKEN)
dotenv.config();

// Import telegram để khởi động bot polling
import './telegram.js';

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(express.json());

// Routes
app.use('/webhook', webhookRoutes);

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'Shopee Notifier Bot',
        version: '1.0.0',
        endpoints: {
            'POST /webhook/orders': 'Nhận danh sách orders để so sánh và thông báo',
            'POST /webhook/delivered': 'Nhận thông báo đơn giao thành công',
            'GET /webhook/health': 'Health check'
        }
    });
});

// Start server
app.listen(PORT, () => {
    console.log('');
    console.log('🤖 Shopee Notifier Bot started!');
    console.log(`📡 Webhook server: http://localhost:${PORT}`);
    console.log(`📬 Endpoints:`);
    console.log(`   POST /webhook/orders    - Nhận orders`);
    console.log(`   POST /webhook/delivered - Nhận delivered`);
    console.log(`   GET  /webhook/health    - Health check`);
    console.log('');
    console.log('💡 Gửi /start đến bot Telegram để lấy Chat ID');
    console.log('');
});

/**
 * Scheduler - Cron jobs cho việc check đơn hàng định kỳ
 * 
 * @module logic/scheduler
 */

const cron = require('node-cron');
const { checkActive, checkExternalTracking, fixMismatchedMethods } = require('./checker.cjs');
const db = require('../database/db.cjs');
const { sendOrdersWebhook } = require('../services/webhook.cjs');

// Helper: Timestamp cho log
function ts() {
    return new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}
function log(tag, msg) { console.log(`[${ts()}] [${tag}] ${msg}`); }

let isRunning = false;

/**
 * Chạy tất cả các checks
 */
async function runAllChecks() {
    if (isRunning) {
        log('Scheduler', '⚠️ Lần check trước chưa xong, bỏ qua...');
        return;
    }

    isRunning = true;
    const startTime = Date.now();
    console.log(`\n${'='.repeat(60)}`);
    log('Scheduler', `🚀 Bắt đầu kiểm tra đơn hàng...`);
    console.log('='.repeat(60));

    try {
        // 0. Fix data inconsistency (method=0 but has tracking_number)
        await fixMismatchedMethods();

        // 1. Check active cookies (Method 3 -> gọi Shopee)
        const activeResults = await checkActive();
        if (activeResults) {
            log('Scheduler', `   → Tổng hợp: ${activeResults.newMvd} MVD mới, ${activeResults.waiting} đang chờ, ${activeResults.skip} bỏ qua quét Shopee`);
        }

        // 2. Check orders có MVD qua API SPX/GHN
        const externalResults = await checkExternalTracking();
        if (externalResults) {
            log('Scheduler', `   → Tổng hợp: ${externalResults.delivered} đã giao, ${externalResults.in_transit} đang vận chuyển, ${externalResults.error} lỗi API`);
        }

        // 3. Gửi webhook đến Notifier Bot
        log('Scheduler', `[3/3] Gửi webhook đến Notifier Bot...`);
        const allOrders = await db.getAllActiveOrders();
        if (allOrders.length > 0) {
            await sendOrdersWebhook(allOrders);
        } else {
            log('Scheduler', `  → Không có đơn active để gửi`);
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        log('Scheduler', `✅ Hoàn thành trong ${duration}s`);
        console.log('='.repeat(60) + '\n');

    } catch (error) {
        console.error(`[${ts()}] [Scheduler] ❌ Lỗi:`, error);
    } finally {
        isRunning = false;
    }
}

/**
 * Khởi động scheduler
 * Chạy mỗi 5 phút
 */
function startScheduler() {
    log('Scheduler', '📦 Khởi động cron job (mỗi 5 phút)...');

    // Chạy ngay lần đầu khi server start
    setTimeout(() => {
        log('Scheduler', '🔄 Chạy check lần đầu...');
        runAllChecks();
    }, 5000);

    // Schedule chạy mỗi 5 phút
    cron.schedule('*/5 * * * *', () => {
        runAllChecks();
    });

    log('Scheduler', '✅ Cron job đã được lên lịch: */5 * * * *');
}

/**
 * Chạy check thủ công (nếu cần)
 */
async function manualCheck() {
    log('Scheduler', '👉 Manual check triggered bởi user');
    return await runAllChecks();
}

module.exports = { startScheduler, manualCheck, runAllChecks };

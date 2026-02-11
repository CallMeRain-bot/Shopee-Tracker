/**
 * Scheduler - Cron jobs cho việc check đơn hàng định kỳ
 * 
 * @module logic/scheduler
 */

const cron = require('node-cron');
const { checkQueue, checkActive, checkExternalTracking } = require('./checker.cjs');
const db = require('../database/db.cjs');
const { sendOrdersWebhook } = require('../services/webhook.cjs');

let isRunning = false;

/**
 * Chạy tất cả các checks
 */
async function runAllChecks() {
    if (isRunning) {
        console.log('[Scheduler] Previous check still running, skipping...');
        return;
    }

    isRunning = true;
    const startTime = Date.now();
    console.log(`\n[Scheduler] Starting checks at ${new Date().toLocaleString('vi-VN')}`);

    try {
        // 1. Check pending cookies (chờ có đơn)
        console.log('[Scheduler] Checking pending queue...');
        const queueResults = await checkQueue();
        if (queueResults.length > 0) {
            console.log(`[Scheduler] Queue results: ${JSON.stringify(queueResults)}`);
        }

        // 2. Check active cookies (chưa có MVD - gọi Shopee)
        console.log('[Scheduler] Checking active orders (waiting for tracking)...');
        const activeResults = await checkActive();
        if (activeResults.length > 0) {
            const trackingFound = activeResults.filter(r => r.status === 'tracking_found').length;
            const waiting = activeResults.filter(r => r.status === 'waiting_tracking').length;
            const hasTracking = activeResults.filter(r => r.status === 'has_tracking').length;
            const skippedNoMvd = activeResults.filter(r => r.status === 'skip_waiting_tracking').length;
            console.log(`[Scheduler] Active results: ${trackingFound} new tracking, ${waiting} waiting, ${hasTracking} already have tracking, ${skippedNoMvd} skipped (no MVD)`);
        }

        // 3. Check orders có MVD qua API SPX/GHN
        console.log('[Scheduler] Checking external tracking (SPX/GHN)...');
        const externalResults = await checkExternalTracking();
        if (externalResults.length > 0) {
            const delivered = externalResults.filter(r => r.status === 'delivered').length;
            const tracking = externalResults.filter(r => r.status === 'tracking').length;
            const errors = externalResults.filter(r => r.status === 'error').length;
            console.log(`[Scheduler] External results: ${delivered} delivered, ${tracking} tracking, ${errors} errors`);
        }

        // 4. Gửi webhook đến Notifier Bot
        console.log('[Scheduler] Sending webhook to notifier bot...');
        const allOrders = await db.getAllActiveOrders();
        if (allOrders.length > 0) {
            await sendOrdersWebhook(allOrders);
        } else {
            console.log('[Scheduler] No active orders to send');
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[Scheduler] All checks completed in ${duration}s\n`);

    } catch (error) {
        console.error('[Scheduler] Error during checks:', error);
    } finally {
        isRunning = false;
    }
}

/**
 * Khởi động scheduler
 * Chạy mỗi 5 phút
 */
function startScheduler() {
    console.log('[Scheduler] Starting cron job (every 5 minutes)...');

    // Chạy ngay lần đầu khi server start
    setTimeout(() => {
        console.log('[Scheduler] Running initial check...');
        runAllChecks();
    }, 5000); // Delay 5s để server khởi động xong

    // Schedule chạy mỗi 5 phút
    cron.schedule('*/5 * * * *', () => {
        runAllChecks();
    });

    console.log('[Scheduler] Cron job scheduled: */5 * * * *');
}

/**
 * Chạy check thủ công (nếu cần)
 */
async function manualCheck() {
    console.log('[Scheduler] Manual check triggered');
    return await runAllChecks();
}

module.exports = { startScheduler, manualCheck, runAllChecks };

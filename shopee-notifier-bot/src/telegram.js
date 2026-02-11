/**
 * Telegram Module - Gửi thông báo qua Telegram Bot
 * 
 * @module telegram
 */

import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

if (!BOT_TOKEN) {
    console.error('[Telegram] BOT_TOKEN is required in .env');
    process.exit(1);
}

// Khởi tạo bot (polling mode để nhận /start command)
const bot = new TelegramBot(BOT_TOKEN, {
    polling: {
        interval: 1000,        // Poll mỗi 1 giây
        autoStart: true,
        params: {
            timeout: 30        // Long polling timeout
        }
    }
});

// Xử lý lỗi polling - tự động retry khi mất kết nối
bot.on('polling_error', (error) => {
    console.error(`[Telegram] Polling error: ${error.code} - ${error.message}`);

    // Nếu là lỗi kết nối, đợi rồi retry
    if (error.code === 'EFATAL' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
        console.log('[Telegram] Connection lost, will auto-retry...');
    }
});

// Xử lý lỗi webhook (nếu có)
bot.on('error', (error) => {
    console.error('[Telegram] Bot error:', error.message);
});

// Lưu chat ID khi user gửi /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    console.log(`[Telegram] Received /start from chat ID: ${chatId}`);
    bot.sendMessage(chatId, `✅ Bot đã kết nối!\n\nChat ID của bạn: \`${chatId}\`\n\nHãy thêm Chat ID này vào file .env của bot.`, {
        parse_mode: 'Markdown'
    });
});

// Command /status - kiểm tra trạng thái bot
bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🟢 Bot đang hoạt động!');
});

/**
 * Format thời gian theo định dạng HH:MM - DD/MM
 * @param {Date|string} date 
 * @returns {string}
 */
function formatTime(date) {
    const d = new Date(date);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${hours}:${minutes} - ${day}/${month}`;
}

/**
 * Gửi thông báo đơn mới
 * @param {Object} order - Order data
 */
export async function sendNewOrderNotification(order) {
    if (!CHAT_ID) {
        console.error('[Telegram] CHAT_ID not configured. Use /start to get your chat ID.');
        return;
    }

    // Build location info
    const locationInfo = [];
    if (order.next_location) locationInfo.push(`🎯 Điểm đến: ${order.next_location}`);
    if (order.current_location) locationInfo.push(`📌 Hiện tại: ${order.current_location}`);
    const locationText = locationInfo.length > 0 ? '\n' + locationInfo.join('\n') : '';

    const message = `⏰ ${formatTime(new Date()).toUpperCase()}

📦 ${order.product || 'Sản phẩm'}, SL: ${order.quantity || 1}
🚚 MVĐ: ${order.tracking_number || 'Chưa có'}
📍 ${order.status || 'Đang xử lý'}${locationText}

🆕 ĐƠN MỚI`;

    try {
        await bot.sendMessage(CHAT_ID, message);
        console.log(`[Telegram] Sent new order notification: ${order.id}`);
    } catch (e) {
        console.error('[Telegram] Error sending message:', e.message);
    }
}

/**
 * Gửi thông báo cập nhật trạng thái
 * @param {Object} order - Order data
 */
export async function sendStatusUpdateNotification(order) {
    if (!CHAT_ID) {
        console.error('[Telegram] CHAT_ID not configured.');
        return;
    }

    // Build location info
    const locationInfo = [];
    if (order.next_location) locationInfo.push(`🎯 Điểm đến: ${order.next_location}`);
    if (order.current_location) locationInfo.push(`📌 Hiện tại: ${order.current_location}`);
    const locationText = locationInfo.length > 0 ? '\n' + locationInfo.join('\n') : '';

    const message = `⏰ ${formatTime(new Date()).toUpperCase()}

📦 ${order.product || 'Sản phẩm'}, SL: ${order.quantity || 1}
🚚 MVĐ: ${order.tracking_number || 'Chưa có'}
📍 ${order.status || 'Đang xử lý'}${locationText}`;

    try {
        await bot.sendMessage(CHAT_ID, message);
        console.log(`[Telegram] Sent status update notification: ${order.id}`);
    } catch (e) {
        console.error('[Telegram] Error sending message:', e.message);
    }
}

/**
 * Gửi thông báo giao hàng thành công
 * @param {Object} order - Order data
 */
export async function sendDeliveredNotification(order) {
    if (!CHAT_ID) {
        console.error('[Telegram] CHAT_ID not configured.');
        return;
    }

    // Build location info
    const locationInfo = [];
    if (order.next_location) locationInfo.push(`🎯 Điểm đến: ${order.next_location}`);
    if (order.current_location) locationInfo.push(`📌 Hiện tại: ${order.current_location}`);
    const locationText = locationInfo.length > 0 ? '\n' + locationInfo.join('\n') : '';

    const message = `⏰ ${formatTime(new Date()).toUpperCase()}

📦 ${order.product || 'Sản phẩm'}, SL: ${order.quantity || 1}
🚚 MVĐ: ${order.tracking_number || 'N/A'}
📍 ${order.status || 'Đã giao thành công'}${locationText}

✅ GIAO HÀNG THÀNH CÔNG`;

    try {
        await bot.sendMessage(CHAT_ID, message);
        console.log(`[Telegram] Sent delivered notification: ${order.id}`);
    } catch (e) {
        console.error('[Telegram] Error sending message:', e.message);
    }
}

export { bot };

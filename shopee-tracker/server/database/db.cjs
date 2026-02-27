const { createClient } = require('@supabase/supabase-js');
const { encrypt, decrypt } = require('../services/crypto.cjs');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = {
    // --- COOKIES ---
    getCookies: async (status) => {
        let query = supabase.from('cookies').select('*');
        if (status) query = query.eq('status', status);

        const { data, error } = await query;
        if (error) { console.error("DB Error getCookies:", error); return []; }

        return data.map(row => {
            try {
                const decrypted = decrypt(row.data_encrypted);
                return {
                    id: row.id,
                    ...decrypted,
                    status: row.status,
                    created_at: row.created_at
                };
            } catch (e) {
                console.error(`Decrypt failed for cookie ID ${row.id}`, e);
                return null;
            }
        }).filter(c => c !== null);
    },

    getCookie: async (id) => {
        const { data, error } = await supabase.from('cookies').select('*').eq('id', id).single();
        if (error || !data) return null;

        try {
            const decrypted = decrypt(data.data_encrypted);
            return {
                id: data.id,
                ...decrypted,
                status: data.status,
                created_at: data.created_at
            };
        } catch (e) {
            console.error(`Decrypt failed for cookie ID ${data.id}`, e);
            return null;
        }
    },

    getAllCookies: async () => {
        const { data, error } = await supabase.from('cookies').select('*');
        if (error) { console.error("DB Error getAllCookies:", error); return []; }

        return data.map(row => {
            try {
                const decrypted = decrypt(row.data_encrypted);
                return {
                    id: row.id,
                    ...decrypted,
                    status: row.status,
                    created_at: row.created_at
                };
            } catch (e) {
                return null;
            }
        }).filter(c => c !== null);
    },

    addCookie: async (cookie, status = 'pending') => {
        const rawData = { cookie };
        const encrypted = encrypt(rawData);

        const { data, error } = await supabase
            .from('cookies')
            .insert([{ data_encrypted: encrypted, status }])
            .select();

        if (error) throw new Error(error.message);
        return data[0].id;
    },

    updateCookie: async (id, updates) => {
        const payload = {};
        if (updates.status) payload.status = updates.status;
        if (updates.cookie) {
            payload.data_encrypted = encrypt({ cookie: updates.cookie });
        }

        const { error } = await supabase.from('cookies').update(payload).eq('id', id);
        if (error) console.error("DB Error updateCookie:", error);
    },

    deleteCookie: async (id) => {
        const { error } = await supabase.from('cookies').delete().eq('id', id);
        if (error) console.error("DB Error deleteCookie:", error);
    },

    checkAndDeleteCookieIfEmpty: async (cookieId) => {
        if (!cookieId) return;

        const { count, error } = await supabase
            .from('orders_cache')
            .select('*', { count: 'exact', head: true })
            .eq('cookie_id', cookieId);

        if (error) {
            console.error("DB Error checkAndDeleteCookieIfEmpty (Count):", error);
            return;
        }

        if (count === 0) {
            console.log(`[DB] Cookie ID ${cookieId} has no more active orders. Deleting...`);
            const { error: delErr } = await supabase.from('cookies').delete().eq('id', cookieId);
            if (delErr) console.error("DB Error checkAndDeleteCookieIfEmpty (Delete):", delErr);
        }
    },

    cleanupOrphanCookies: async () => {
        // Lấy tất cả cookie đang ở trạng thái 'active'
        const { data: cookies, error: cErr } = await supabase
            .from('cookies')
            .select('id')
            .eq('status', 'active');

        if (cErr) {
            console.error("DB Error cleanupOrphanCookies (Fetch cookies):", cErr);
            return 0;
        }

        if (cookies.length === 0) return 0;

        // Lấy danh sách cookie_id đang có trong orders_cache
        const { data: activeOrders, error: oErr } = await supabase
            .from('orders_cache')
            .select('cookie_id');

        if (oErr) {
            console.error("DB Error cleanupOrphanCookies (Fetch orders):", oErr);
            return 0;
        }

        const activeCookieIds = new Set(activeOrders.map(o => o.cookie_id));
        const orphanCookieIds = cookies
            .filter(c => !activeCookieIds.has(c.id))
            .map(c => c.id);

        if (orphanCookieIds.length > 0) {
            console.log(`[DB] Cleaning up ${orphanCookieIds.length} orphan active cookies:`, orphanCookieIds);
            const { error: delErr } = await supabase
                .from('cookies')
                .delete()
                .in('id', orphanCookieIds);

            if (delErr) console.error("DB Error cleanupOrphanCookies (Delete):", delErr);
            return orphanCookieIds.length;
        }

        return 0;
    },

    // --- ORDER CACHE ---
    getCache: async (orderId) => {
        const { data, error } = await supabase.from('orders_cache').select('*').eq('order_id', orderId).single();
        if (error || !data) return null;

        const decrypted = decrypt(data.data_encrypted);
        return decrypted.status;
    },

    // Lấy full cache data (bao gồm tracking_number)
    getFullCache: async (orderId) => {
        const { data, error } = await supabase.from('orders_cache').select('*').eq('order_id', orderId).single();
        if (error || !data) return null;

        try {
            const decrypted = decrypt(data.data_encrypted);
            return {
                ...decrypted,
                tracking_number: data.tracking_number,
                carrier: data.carrier,
                cookie_id: data.cookie_id,
                updated_at: data.updated_at
            };
        } catch (e) {
            return null;
        }
    },

    getAllActiveOrders: async () => {
        const { data, error } = await supabase.from('orders_cache').select('*');
        if (error) { console.error("DB Error getAllActiveOrders:", error); return []; }

        return data.map(row => {
            try {
                const decrypted = decrypt(row.data_encrypted);
                return {
                    ...decrypted,
                    tracking_number: row.tracking_number,
                    carrier: row.carrier,
                    tracking_method: row.tracking_method,
                    cookie_id: row.cookie_id,
                    updated_at: row.updated_at
                };
            } catch (e) {
                return null;
            }
        }).filter(o => o !== null);
    },

    // Lấy orders chưa có mã vận đơn
    getOrdersWaitingTracking: async () => {
        const { data, error } = await supabase
            .from('orders_cache')
            .select('*')
            .or('tracking_number.is.null,tracking_number.eq.Không xác định');

        if (error) { console.error("DB Error getOrdersWaitingTracking:", error); return []; }

        return data.map(row => {
            try {
                const decrypted = decrypt(row.data_encrypted);
                return {
                    ...decrypted,
                    cookie_id: row.cookie_id,
                    updated_at: row.updated_at
                };
            } catch (e) {
                return null;
            }
        }).filter(o => o !== null);
    },

    // Lấy orders có tracking_method = 0 (chờ MVD, cần check qua Shopee API)
    getOrdersWithTrackingZero: async () => {
        const { data, error } = await supabase
            .from('orders_cache')
            .select('*')
            .eq('tracking_method', 0);

        if (error) { console.error("DB Error getOrdersWithTrackingZero:", error); return []; }

        return data.map(row => {
            try {
                const decrypted = decrypt(row.data_encrypted);
                return {
                    ...decrypted,
                    tracking_number: row.tracking_number,
                    tracking_method: row.tracking_method,
                    cookie_id: row.cookie_id,
                    updated_at: row.updated_at
                };
            } catch (e) {
                return null;
            }
        }).filter(o => o !== null);
    },

    // Lấy orders đã có mã vận đơn VÀ tracking_method = 1 (SPX) hoặc 2 (GHN)
    getOrdersWithTracking: async () => {
        const { data, error } = await supabase
            .from('orders_cache')
            .select('*')
            .in('tracking_method', [1, 2]); // 1=SPX, 2=GHN

        if (error) { console.error("DB Error getOrdersWithTracking:", error); return []; }

        return data.map(row => {
            try {
                const decrypted = decrypt(row.data_encrypted);
                return {
                    ...decrypted,
                    tracking_number: row.tracking_number,
                    carrier: row.carrier,
                    cookie_id: row.cookie_id,
                    updated_at: row.updated_at
                };
            } catch (e) {
                return null;
            }
        }).filter(o => o !== null);
    },

    setCache: async (orderId, orderData, cookieId = null) => {
        const encrypted = encrypt(orderData);

        const payload = {
            order_id: orderId,
            data_encrypted: encrypted,
            status: orderData.status,
            tracking_number: orderData.tracking_number || null,
            carrier: orderData.carrier || null,
            tracking_method: orderData.tracking_method ?? 0, // 0=Shopee by default
            updated_at: new Date()
        };
        if (cookieId) payload.cookie_id = cookieId;

        const { error } = await supabase
            .from('orders_cache')
            .upsert(payload, { onConflict: 'order_id' });

        if (error) console.error("DB Error setCache:", error);
    },

    // Cập nhật tracking_number, carrier và tracking_method cho order
    updateOrderTracking: async (orderId, trackingNumber, carrier, trackingMethod) => {
        const { error } = await supabase
            .from('orders_cache')
            .update({
                tracking_number: trackingNumber,
                carrier: carrier,
                tracking_method: trackingMethod,
                updated_at: new Date()
            })
            .eq('order_id', orderId);

        if (error) console.error("DB Error updateOrderTracking:", error);
    },

    deleteCache: async (orderId) => {
        const { error } = await supabase.from('orders_cache').delete().eq('order_id', orderId);
        if (error) console.error("DB Error deleteCache:", error);
    },

    getCachesByCookie: async (cookieId) => {
        const { data, error } = await supabase
            .from('orders_cache')
            .select('*')
            .eq('cookie_id', cookieId);

        if (error) { console.error("DB Error getCachesByCookie:", error); return []; }

        return data.map(row => {
            try {
                return decrypt(row.data_encrypted);
            } catch (e) {
                return null;
            }
        }).filter(o => o !== null);
    },

    // --- DELIVERED ---
    markDelivered: async (orderId, orderData) => {
        const encrypted = encrypt(orderData);

        const { error: errInsert } = await supabase
            .from('delivered')
            .insert([{
                order_id: orderId,
                data_encrypted: encrypted,
                delivered_at: new Date()
            }]);

        if (errInsert) console.error("DB Error markDelivered (Insert):", errInsert);
    },

    getDelivered: async (limit = 10, offset = 0) => {
        const { data, error } = await supabase
            .from('delivered')
            .select('*')
            .order('delivered_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) { console.error("DB Error getDelivered:", error); return []; }

        return data.map(row => {
            try {
                const decrypted = decrypt(row.data_encrypted);
                return {
                    ...decrypted,
                    delivered_at: row.delivered_at
                };
            } catch (e) {
                console.error(`Decrypt failed for order ${row.order_id}`, e);
                return null;
            }
        }).filter(o => o !== null);
    },

    // Cursor-based pagination for infinite scroll
    getDeliveredCursor: async (cursor = null, limit = 30) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
            let query = supabase
                .from('delivered')
                .select('*')
                .order('delivered_at', { ascending: false })
                .limit(limit);

            if (cursor) {
                query = query.lt('delivered_at', cursor);
            }

            const { data, error } = await query;
            clearTimeout(timeout);

            if (error) { console.error("DB Error getDeliveredCursor:", error); return { orders: [], nextCursor: null, hasMore: false }; }

            const orders = data.map(row => {
                try {
                    const decrypted = decrypt(row.data_encrypted);
                    return {
                        ...decrypted,
                        id: row.order_id,
                        delivered_at: row.delivered_at
                    };
                } catch (e) {
                    console.error(`Decrypt failed for order ${row.order_id}`, e);
                    return null;
                }
            }).filter(o => o !== null);

            const nextCursor = orders.length === limit ? orders[orders.length - 1].delivered_at : null;

            return {
                orders,
                nextCursor,
                hasMore: orders.length === limit
            };
        } catch (e) {
            clearTimeout(timeout);
            if (e.name === 'AbortError') {
                console.error("DB Timeout getDeliveredCursor");
                throw new Error('Database query timed out');
            }
            throw e;
        }
    },

    countDelivered: async () => {
        const { count, error } = await supabase
            .from('delivered')
            .select('*', { count: 'exact', head: true });
        if (error) { console.error("DB Error countDelivered:", error); return 0; }
        return count || 0;
    },

    updateDelivered: async (orderId, newData) => {
        // 1. Fetch current row
        const { data: row, error: fetchErr } = await supabase
            .from('delivered')
            .select('*')
            .eq('order_id', orderId)
            .single();

        if (fetchErr || !row) {
            console.error("DB Error updateDelivered (Fetch):", fetchErr);
            return false;
        }

        // 2. Decrypt existing data
        let existing = {};
        try {
            existing = decrypt(row.data_encrypted);
        } catch (e) {
            console.error(`Decrypt failed for delivered order ${orderId}`, e);
            return false;
        }

        // 3. Merge with new data
        const merged = { ...existing, ...newData };

        // 4. Re-encrypt and update
        const reEncrypted = encrypt(merged);
        const { error: updateErr } = await supabase
            .from('delivered')
            .update({ data_encrypted: reEncrypted })
            .eq('order_id', orderId);

        if (updateErr) {
            console.error("DB Error updateDelivered (Update):", updateErr);
            return false;
        }
        return true;
    },

    deleteDelivered: async (orderId) => {
        const { error } = await supabase.from('delivered').delete().eq('order_id', orderId);
        if (error) { console.error("DB Error deleteDelivered:", error); return false; }
        return true;
    },

    // --- STATS ---
    getStats: async () => {
        const [pending, active, disabled, delivered] = await Promise.all([
            supabase.from('cookies').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
            supabase.from('cookies').select('*', { count: 'exact', head: true }).eq('status', 'active'),
            supabase.from('cookies').select('*', { count: 'exact', head: true }).eq('status', 'disabled'),
            supabase.from('delivered').select('*', { count: 'exact', head: true })
        ]);

        return {
            pending: pending.count || 0,
            active: active.count || 0,
            disabled: disabled.count || 0,
            delivered: delivered.count || 0
        };
    },

    // --- ORDER TRACKING JOURNEY ---
    getTrackingJourney: async (trackingNumber) => {
        const { data, error } = await supabase
            .from('order_tracking')
            .select('*')
            .eq('tracking_number', trackingNumber)
            .single();

        if (error || !data) return null;
        return data;
    },

    setTrackingJourney: async (trackingNumber, records) => {
        const { error } = await supabase
            .from('order_tracking')
            .upsert({
                tracking_number: trackingNumber,
                records: records,
                last_fetched: new Date()
            }, { onConflict: 'tracking_number' });

        if (error) console.error("DB Error setTrackingJourney:", error);
    },

    deleteTrackingJourney: async (trackingNumber) => {
        const { error } = await supabase
            .from('order_tracking')
            .delete()
            .eq('tracking_number', trackingNumber);

        if (error) console.error("DB Error deleteTrackingJourney:", error);
    }
};

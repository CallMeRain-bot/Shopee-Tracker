import { getAccessToken } from './supabase';

// Dynamic API base: dev = '/api', production = '/tracker/api'
const API_BASE = `${import.meta.env.BASE_URL}api`.replace('//', '/');

/**
 * Get authorization headers with JWT token
 */
const getAuthHeaders = async () => {
    const token = await getAccessToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
    };
};

/**
 * Authenticated fetch wrapper
 */
const authFetch = async (url, options = {}) => {
    const headers = await getAuthHeaders();
    const res = await fetch(url, {
        ...options,
        headers: {
            ...headers,
            ...options.headers
        }
    });

    // Handle 401 - redirect to login
    if (res.status === 401) {
        window.location.reload(); // Will trigger auth check and show login
        throw new Error('Unauthorized');
    }

    return res;
};

export const api = {
    // Stats
    getStats: async () => {
        const res = await authFetch(`${API_BASE}/stats`);
        return res.json();
    },

    // Cookies
    getCookies: async () => {
        const res = await authFetch(`${API_BASE}/cookies`);
        return res.json();
    },

    addCookie: async (cookie, checkNow = true) => {
        const res = await authFetch(`${API_BASE}/cookies`, {
            method: 'POST',
            body: JSON.stringify({ cookie, checkNow })
        });
        return res.json();
    },

    deleteCookie: async (id) => {
        const res = await authFetch(`${API_BASE}/cookies/${id}`, { method: 'DELETE' });
        return res.json();
    },

    updateCookieStatus: async (id, status) => {
        const res = await authFetch(`${API_BASE}/cookies/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status })
        });
        return res.json();
    },

    checkCookie: async (id) => {
        const res = await authFetch(`${API_BASE}/cookies/${id}/check`, { method: 'POST' });
        return res.json();
    },

    // Orders
    getActiveOrders: async () => {
        const res = await authFetch(`${API_BASE}/orders/active`);
        return res.json();
    },

    getHistory: async (cursor = null, limit = 30) => {
        const params = new URLSearchParams({ limit });
        if (cursor) params.set('cursor', cursor);
        const res = await authFetch(`${API_BASE}/orders/history?${params}`);
        return res.json();
    },

    updateDeliveredOrder: async (orderId, data) => {
        const res = await authFetch(`${API_BASE}/orders/history/${orderId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
        return res.json();
    },

    deleteDeliveredOrder: async (orderId) => {
        const res = await authFetch(`${API_BASE}/orders/history/${orderId}`, {
            method: 'DELETE'
        });
        return res.json();
    },

    forceCheckAll: async () => {
        const res = await authFetch(`${API_BASE}/orders/check-all`, { method: 'POST' });
        return res.json();
    },

    // Force check - gọi Shopee API để phát hiện đơn huỷ
    // mode: 'normal' (default) - chỉ check orders có tracking_method=0
    // mode: 'all' - check tất cả orders để phát hiện đơn huỷ/cookie khoá
    forceCheck: async (mode = 'normal') => {
        const res = await authFetch(`${API_BASE}/orders/force-check?mode=${mode}`, { method: 'POST' });
        return res.json();
    },

    // SSE for real-time updates - with authentication token
    subscribeToEvents: async (onMessage) => {
        const token = await getAccessToken();
        // EventSource doesn't support custom headers, use query param for auth
        const url = token
            ? `${API_BASE}/events?token=${encodeURIComponent(token)}`
            : `${API_BASE}/events`;
        const eventSource = new EventSource(url);
        eventSource.onmessage = (e) => {
            const data = JSON.parse(e.data);
            onMessage(data);
        };
        return () => eventSource.close();
    }
};


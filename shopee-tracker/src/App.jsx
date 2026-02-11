import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './services/api';
import { supabase, signOut, getAccessToken } from './services/supabase';
import { decodeHTMLEntities, getShopeeImageUrl } from './utils';
import Login from './components/Login';
import HistoryList from './components/HistoryList';
import './index.css';

// Material Icons CDN loaded in index.html

// Masonry helper - chia thẻ vào các cột theo thứ tự ngang (1→col1, 2→col2, 3→col3, 4→col1...)
const splitIntoColumns = (items, columnCount) => {
    const columns = Array.from({ length: columnCount }, () => []);
    items.forEach((item, index) => {
        columns[index % columnCount].push(item);
    });
    return columns;
};

function App() {
    // Auth state
    const [user, setUser] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);

    // App state
    const [currentPage, setCurrentPage] = useState('orders');
    const [stats, setStats] = useState({ pending: 0, active: 0, disabled: 0, delivered: 0 });
    const [cookies, setCookies] = useState([]);
    const [orders, setOrders] = useState([]);
    const historyRefreshRef = useRef(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [newCookie, setNewCookie] = useState('');
    const [forceCheckLoading, setForceCheckLoading] = useState(false);

    // Edit delivered order state
    const [editingOrder, setEditingOrder] = useState(null);
    const [editForm, setEditForm] = useState({});

    // Fetch data
    const fetchData = useCallback(async () => {
        try {
            const [statsData, cookiesData, ordersData] = await Promise.all([
                api.getStats(),
                api.getCookies(),
                api.getActiveOrders()
            ]);
            setStats(statsData);
            setCookies(cookiesData);
            setOrders(ordersData);
        } catch (e) {
            console.error('Fetch error:', e);
        } finally {
            setIsLoading(false);
        }
    }, []);



    useEffect(() => {
        // Check initial session
        const initAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setUser(session?.user || null);
            setAuthLoading(false);
        };
        initAuth();

        // Subscribe to auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (event, session) => {
                setUser(session?.user || null);
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (!user) return; // Chỉ fetch khi đã login
        fetchData();

        // SSE subscription (async)
        let unsubscribe = null;
        const setupSSE = async () => {
            unsubscribe = await api.subscribeToEvents(() => {
                fetchData(); // Refresh on any event
            });
        };
        setupSSE();

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, [fetchData, user]);



    // Handlers
    const handleAddCookie = async () => {
        if (!newCookie.trim()) return;
        try {
            await api.addCookie(newCookie.trim());
            setNewCookie('');
            setShowAddModal(false);
            fetchData();
        } catch (e) {
            console.error('Add cookie error:', e);
        }
    };

    const handleDeleteCookie = async (id) => {
        if (!confirm('Xóa cookie này?')) return;
        try {
            await api.deleteCookie(id);
            fetchData();
        } catch (e) {
            console.error('Delete error:', e);
        }
    };

    const handleCheckCookie = async (id) => {
        try {
            const result = await api.checkCookie(id);
            let msg = `Cookie #${id}: `;

            if (result.activated) {
                msg = `✅ Cookie #${id} đã được kích hoạt!\n`;
                msg += `📦 Đang giao: ${result.ordersCount}\n`;
                if (result.completedCount > 0) msg += `✅ Đã giao: ${result.completedCount}\n`;
                if (result.cancelledCount > 0) msg += `⚠️ Đã huỷ: ${result.cancelledCount}\n`;
            } else if (result.status === 'deleted_empty') {
                msg = `ℹ️ Cookie #${id} đã được xử lý:\n`;
                if (result.completedCount > 0) msg += `✅ Đã giao: ${result.completedCount} (Đã thêm vào lịch sử)\n`;
                if (result.cancelledCount > 0) msg += `⚠️ Đã huỷ: ${result.cancelledCount}\n`;
                msg += `\nVì không còn đơn hàng nào đang giao, cookie này đã được tự động xoá.`;
            } else if (result.ordersCount === 0) {
                if (result.completedCount > 0 || result.cancelledCount > 0) {
                    msg = `ℹ️ Cookie #${id}:\n`;
                    if (result.completedCount > 0) msg += `✅ Đã giao: ${result.completedCount}\n`;
                    if (result.cancelledCount > 0) msg += `⚠️ Đã huỷ: ${result.cancelledCount}\n`;
                    msg += `\nKhông có đơn hàng nào đang giao.`;
                } else {
                    msg = `⏳ Cookie #${id} chưa có đơn hàng. Vui lòng thử lại sau.`;
                }
            } else {
                msg += `${result.ordersCount} đơn hàng đang giao.`;
                if (result.completedCount > 0) msg += ` (Đã giao: ${result.completedCount})`;
            }

            alert(msg);
            fetchData();
        } catch (e) {
            console.error('Check cookie error:', e);
            alert('❌ Lỗi khi check cookie: ' + e.message);
        }
    };

    const handleLogout = async () => {
        try {
            await signOut();
            setUser(null);
        } catch (e) {
            console.error('Logout error:', e);
        }
    };

    const [showForceCheckMenu, setShowForceCheckMenu] = useState(false);

    const handleForceCheck = async (mode = 'normal') => {
        if (forceCheckLoading) return;
        setShowForceCheckMenu(false);
        setForceCheckLoading(true);
        try {
            const result = await api.forceCheck(mode);
            let messages = [];

            // Xử lý cookie hết hạn (Error 19)
            const expiredCookies = result.errors?.filter(e => e.error?.includes('Error 19') || e.action === 'disabled_and_cleaned') || [];
            if (expiredCookies.length > 0) {
                const expiredInfo = expiredCookies.map(e =>
                    `Cookie #${e.cookieId}: Đã bị vô hiệu hoá, xoá ${e.deletedOrders || 0} đơn`
                ).join('\n');
                messages.push(`🍪 ${expiredCookies.length} cookie hết hạn (Error 19):\n${expiredInfo}`);
            }

            // Xử lý đơn bị huỷ
            if (result.cancelled && result.cancelled.length > 0) {
                const cancelledInfo = result.cancelled.map(c =>
                    c.orderId ? `Đơn #${c.orderId}: ${c.reason}` : `Cookie #${c.cookieId}: ${c.reason}`
                ).join('\n');
                messages.push(`⚠️ ${result.cancelled.length} đơn bị huỷ:\n${cancelledInfo}`);
            }

            // Xử lý đơn được cập nhật
            if (result.updated && result.updated.length > 0) {
                messages.push(`✅ ${result.updated.length} đơn được cập nhật`);
            }

            // Hiển thị kết quả
            if (messages.length > 0) {
                alert(messages.join('\n\n'));
            } else {
                alert(`✅ Đã kiểm tra ${result.checked} cookies. Không có thay đổi.`);
            }

            fetchData(); // Refresh data
        } catch (e) {
            console.error('Force check error:', e);
            alert('❌ Lỗi khi kiểm tra: ' + e.message);
        } finally {
            setForceCheckLoading(false);
        }
    };

    // Edit delivered order handlers
    const handleEditDelivered = (order, refreshFn) => {
        setEditForm({
            product: order.product || '',
            amount: order.amount || 1,
            price: order.price || 0,
            tracking_number: order.tracking_number || '',
            shipping: {
                name: order.shipping?.name || '',
                phone: order.shipping?.phone || ''
            }
        });
        setEditingOrder(order);
        if (refreshFn) historyRefreshRef.current = refreshFn;
    };

    const handleSaveEdit = async () => {
        if (!editingOrder) return;
        try {
            await api.updateDeliveredOrder(editingOrder.id, editForm);
            setEditingOrder(null);
            if (historyRefreshRef.current) historyRefreshRef.current();
        } catch (e) {
            console.error('Update delivered error:', e);
            alert('❌ Lỗi cập nhật: ' + e.message);
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        const d = new Date(dateStr);
        const hours = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${hours}:${mins} ${day}/${month}/${year}`;
    };

    const getStatusClass = (status) => {
        const s = status?.toLowerCase() || '';
        if (s.includes('giao hàng thành công') || s.includes('đã giao')) return 'delivered';
        if (s.includes('đang giao') || s.includes('vận chuyển')) return 'shipped';
        if (s.includes('đã hủy')) return 'cancelled';
        return 'processing';
    };

    const getCarrierBadge = (carrier, trackingMethod) => {
        if (trackingMethod === 1) return { text: 'SPX', color: '#ee4d2d' };  // Shopee orange
        if (trackingMethod === 2) return { text: 'GHN', color: '#00bfa5' };  // GHN green
        if (trackingMethod === 3) return { text: 'N/A', color: '#9e9e9e' };  // Unsupported gray
        return { text: 'Shopee', color: '#ff9800' };  // Waiting - orange
    };

    const getTrackingMethodText = (method) => {
        const methods = {
            0: 'Chờ MVD',
            1: 'SPX API',
            2: 'GHN API',
            3: 'Shopee API'
        };
        return methods[method] || 'Unknown';
    };

    // Auth loading state
    if (authLoading) {
        return (
            <div className="auth-loading">
                <div className="spinner"></div>
                <p>Đang kiểm tra đăng nhập...</p>
            </div>
        );
    }

    // Not authenticated - show login
    if (!user) {
        return <Login onLoginSuccess={(u) => setUser(u)} />;
    }

    // Authenticated - show app
    return (
        <div className="app-layout">
            {/* Sidebar */}
            <aside className="sidebar">
                <div className="sidebar-content">
                    <div className="brand">
                        <div className="brand-icon">
                            <span className="material-symbols-outlined">shopping_cart</span>
                        </div>
                        <div className="brand-text">
                            <h1>Shopee Tracker</h1>
                            <p>Power User v2.4</p>
                        </div>
                    </div>

                    <nav className="nav-menu">
                        <button
                            className={`nav-item ${currentPage === 'orders' ? 'active' : ''}`}
                            onClick={() => setCurrentPage('orders')}
                        >
                            <span className="material-symbols-outlined icon">package_2</span>
                            <span>My Orders</span>
                        </button>
                        <button
                            className={`nav-item ${currentPage === 'cookies' ? 'active' : ''}`}
                            onClick={() => setCurrentPage('cookies')}
                        >
                            <span className="material-symbols-outlined icon">cookie</span>
                            <span>Cookies</span>
                        </button>
                        <button
                            className={`nav-item ${currentPage === 'history' ? 'active' : ''}`}
                            onClick={() => setCurrentPage('history')}
                        >
                            <span className="material-symbols-outlined icon">history</span>
                            <span>History</span>
                        </button>
                    </nav>
                </div>

                <div className="sidebar-footer">
                    <button className="logout-btn" onClick={handleLogout}>
                        <span className="material-symbols-outlined">logout</span>
                        <span>Log Out</span>
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="main-content">
                <header className="header">
                    <div className="header-left">
                        <h2>
                            {currentPage === 'orders' && 'Active Orders'}
                            {currentPage === 'cookies' && 'Cookie Management'}
                            {currentPage === 'history' && 'Delivery History'}
                        </h2>
                        <div className="status-badge">
                            <div className={`status-dot ${stats.active > 0 ? 'active' : 'error'}`}></div>
                            <span>Cookie: {stats.active > 0 ? 'Active' : 'Inactive'}</span>
                        </div>
                    </div>

                    <div className="header-actions">
                        <div className="force-check-dropdown">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowForceCheckMenu(!showForceCheckMenu)}
                                disabled={forceCheckLoading}
                                title="Kiểm tra đơn huỷ qua Shopee API"
                            >
                                <span className="material-symbols-outlined">
                                    {forceCheckLoading ? 'sync' : 'refresh'}
                                </span>
                                {forceCheckLoading ? 'Đang check...' : 'Force Check'}
                                <span className="material-symbols-outlined dropdown-arrow">expand_more</span>
                            </button>
                            {showForceCheckMenu && !forceCheckLoading && (
                                <div className="force-check-menu">
                                    <button onClick={() => handleForceCheck('normal')}>
                                        <span className="material-symbols-outlined">schedule</span>
                                        Normal Check
                                        <span className="menu-desc">Chỉ check đơn chờ MVD</span>
                                    </button>
                                    <button onClick={() => handleForceCheck('all')}>
                                        <span className="material-symbols-outlined">fact_check</span>
                                        Check All
                                        <span className="menu-desc">Check tất cả đơn + cookie khoá</span>
                                    </button>
                                </div>
                            )}
                        </div>
                        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                            <span className="material-symbols-outlined">add</span>
                            Add Cookie
                        </button>
                    </div>
                </header>

                <div className="dashboard-content">
                    {isLoading ? (
                        <div className="loading">Loading...</div>
                    ) : (
                        <>
                            {/* Orders Page */}
                            {currentPage === 'orders' && (
                                <div className="orders-section">

                                    {orders.length === 0 ? (
                                        <div className="empty-state">
                                            <span className="material-symbols-outlined icon">local_shipping</span>
                                            <h4>No orders in transit</h4>
                                            <p>Orders being delivered will appear here</p>
                                        </div>
                                    ) : (
                                        <div className="tab-scroll-container">
                                            <div className="order-cards-grid">
                                                {splitIntoColumns(orders, 3).map((columnOrders, colIndex) => (
                                                    <div className="masonry-column" key={colIndex}>
                                                        {columnOrders.map((order, idx) => (
                                                            <div className="order-card" key={order.id || idx}>
                                                                {/* Header: Image + Product Name + Tracking */}
                                                                <div className="order-card-header">
                                                                    <div className="order-card-product-img">
                                                                        {order.image ? (
                                                                            <img
                                                                                src={getShopeeImageUrl(order.image)}
                                                                                alt="Product"
                                                                                onError={(e) => { e.target.src = ''; e.target.style.display = 'none'; }}
                                                                            />
                                                                        ) : (
                                                                            <span className="placeholder">📦</span>
                                                                        )}
                                                                    </div>
                                                                    <div className="order-card-product-info">
                                                                        <h4 className="order-card-product-name">
                                                                            {decodeHTMLEntities(order.product) || 'Sản phẩm'}
                                                                            <span className="product-quantity"> (SL: {order.amount || 1})</span>
                                                                        </h4>
                                                                        <div className="order-card-tracking">
                                                                            <span className="tracking-code">{order.tracking_number || 'Chờ MVD'}</span>
                                                                            <button
                                                                                className="copy-btn"
                                                                                onClick={() => navigator.clipboard.writeText(order.tracking_number || '')}
                                                                                title="Copy mã vận đơn"
                                                                            >
                                                                                <span className="material-symbols-outlined">content_copy</span>
                                                                            </button>
                                                                            {order.tracking_number && (
                                                                                <a
                                                                                    href={`https://tramavandon.com/spx/?tracking_number=${order.tracking_number}`}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    className="copy-btn"
                                                                                    title="Tra cứu vận đơn"
                                                                                >
                                                                                    <span className="material-symbols-outlined">open_in_new</span>
                                                                                </a>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Body: Recipient Info */}
                                                                <div className="order-card-body">
                                                                    <div className="order-card-info-row">
                                                                        <div className="info-column">
                                                                            <div className="info-group">
                                                                                <span className="info-label">NGƯỜI NHẬN</span>
                                                                                <span className="info-value">{order.shipping?.name}</span>
                                                                            </div>
                                                                            <div className="info-group">
                                                                                <span className="info-label">SỐ ĐIỆN THOẠI</span>
                                                                                <span className="info-value phone-value">{order.shipping?.phone}</span>
                                                                            </div>
                                                                        </div>
                                                                        <div className="info-column status-column">
                                                                            <div className="info-group">
                                                                                <div className="info-label-row">
                                                                                    <span className="info-label">TRẠNG THÁI</span>
                                                                                    <span className="material-symbols-outlined info-icon status-icon-small">info</span>
                                                                                </div>
                                                                                <span className="info-value status-text-wrap">{order.status || 'Đang xử lý đơn hàng'}</span>
                                                                            </div>
                                                                            {order.status_time && (
                                                                                <div className="info-group">
                                                                                    <span className="info-label">CẬP NHẬT</span>
                                                                                    <span className="info-value">
                                                                                        {new Date(order.status_time * 1000).toLocaleString('vi-VN', {
                                                                                            hour: '2-digit',
                                                                                            minute: '2-digit',
                                                                                            day: '2-digit',
                                                                                            month: '2-digit'
                                                                                        })}
                                                                                    </span>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Journey Section - Dự báo hành trình */}
                                                                {(order.current_location || order.next_location) && (
                                                                    <div className="order-card-journey">
                                                                        <div className="journey-header">
                                                                            <span className="material-symbols-outlined">route</span>
                                                                            <span>DỰ BÁO HÀNH TRÌNH</span>
                                                                        </div>
                                                                        <div className="journey-content">
                                                                            {order.current_location && (
                                                                                <div className="journey-point">
                                                                                    <span className="journey-label">VỊ TRÍ HIỆN TẠI</span>
                                                                                    <span className="journey-value">{order.current_location}</span>
                                                                                </div>
                                                                            )}
                                                                            {order.current_location && order.next_location && (
                                                                                <div className="journey-arrow">
                                                                                    <span className="material-symbols-outlined">arrow_forward</span>
                                                                                </div>
                                                                            )}
                                                                            {order.next_location && (
                                                                                <div className="journey-point">
                                                                                    <span className="journey-label">
                                                                                        {order.current_location ? 'ĐIỂM ĐẾN TIẾP THEO' : 'ĐIỂM ĐẾN'}
                                                                                    </span>
                                                                                    <span className="journey-value">{order.next_location}</span>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {/* Footer: Price + Updated At */}
                                                                <div className="order-card-footer">
                                                                    <div className="order-card-price">
                                                                        <span className="price-label">TỔNG CỘNG</span>
                                                                        <span className="price-value">
                                                                            {(order.price || 0).toLocaleString()}đ
                                                                        </span>
                                                                    </div>
                                                                    {order.updated_at && (
                                                                        <span className="updated-at">
                                                                            {new Date(order.updated_at).toLocaleString('vi-VN', {
                                                                                day: '2-digit',
                                                                                month: '2-digit',
                                                                                hour: '2-digit',
                                                                                minute: '2-digit'
                                                                            })}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Cookies Page */}
                            {currentPage === 'cookies' && (
                                <div className="orders-card">

                                    {cookies.length === 0 ? (
                                        <div className="empty-state">
                                            <span className="material-symbols-outlined icon">cookie</span>
                                            <h4>No cookies</h4>
                                            <p>Add a Shopee cookie to start tracking</p>
                                        </div>
                                    ) : (
                                        <div className="tab-scroll-container">
                                            <table className="orders-table">
                                                <thead>
                                                    <tr>
                                                        <th>ID</th>
                                                        <th>Cookie Preview</th>
                                                        <th>Status</th>
                                                        <th>Created</th>
                                                        <th>Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {cookies.map((c) => (
                                                        <tr key={c.id}>
                                                            <td className="order-id">#{c.id}</td>
                                                            <td
                                                                style={{ fontFamily: 'monospace', fontSize: '0.75rem', cursor: 'pointer' }}
                                                                title="Click to copy full cookie"
                                                                onClick={() => {
                                                                    navigator.clipboard.writeText(c.cookie);
                                                                    alert(`Đã copy cookie #${c.id}!`);
                                                                }}
                                                                className="cookie-preview-cell"
                                                            >
                                                                {c.cookie?.substring(0, 40)}...
                                                            </td>
                                                            <td>
                                                                <span className={`order-status ${c.status}`}>{c.status}</span>
                                                            </td>
                                                            <td className="order-date">{formatDate(c.created_at)}</td>
                                                            <td>
                                                                <div className="cookie-actions">
                                                                    <button
                                                                        className="btn btn-ghost"
                                                                        onClick={() => {
                                                                            navigator.clipboard.writeText(c.cookie);
                                                                            alert('Cookie đã được copy vào clipboard!');
                                                                        }}
                                                                        title="Copy full cookie"
                                                                    >
                                                                        <span className="material-symbols-outlined">content_copy</span>
                                                                    </button>
                                                                    {c.status === 'pending' && (
                                                                        <button
                                                                            className="btn btn-primary btn-sm"
                                                                            onClick={() => handleCheckCookie(c.id)}
                                                                            title="Check cookie"
                                                                        >
                                                                            <span className="material-symbols-outlined">play_arrow</span>
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        className="btn btn-ghost"
                                                                        onClick={() => handleDeleteCookie(c.id)}
                                                                        title="Delete"
                                                                    >
                                                                        <span className="material-symbols-outlined">delete</span>
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* History Page */}
                            {currentPage === 'history' && (
                                <div className="orders-section">

                                    <HistoryList onEdit={handleEditDelivered} />
                                </div>
                            )}
                        </>
                    )}
                </div>
            </main>

            {/* Mobile UI - Only visible on mobile */}
            <div className="mobile-app">
                {/* Mobile Header */}
                <header className="mobile-header">
                    <div className="mobile-header-brand">
                        <div className="brand-icon">
                            <span className="material-symbols-outlined">shopping_cart</span>
                        </div>
                        <h1>Shopee Tracker</h1>
                    </div>
                    <div className={`mobile-cookie-badge ${stats.active > 0 ? 'active' : 'inactive'}`}>
                        <span className="dot"></span>
                        <span>Cookie: {stats.active > 0 ? 'Active' : 'Inactive'}</span>
                    </div>
                </header>

                {/* Mobile Content */}
                <div className="mobile-content">
                    {isLoading ? (
                        <div className="mobile-empty-state">
                            <div className="spinner"></div>
                            <p>Loading...</p>
                        </div>
                    ) : (
                        <>
                            {/* Dashboard View */}
                            {currentPage === 'dashboard' && (
                                <>
                                    {/* Recent Update Section */}
                                    <p className="mobile-section-title">Recent Update</p>
                                    {orders.length > 0 ? (
                                        (() => {
                                            const latestOrder = orders[0];

                                            return (
                                                <div className="recent-update-card">
                                                    <div className="recent-update-header">
                                                        <div className="recent-update-icon">
                                                            {latestOrder.image ? (
                                                                <img
                                                                    src={getShopeeImageUrl(latestOrder.image)}
                                                                    alt="Product"
                                                                    onError={(e) => { e.target.style.display = 'none'; }}
                                                                />
                                                            ) : (
                                                                <span className="material-symbols-outlined">inventory_2</span>
                                                            )}
                                                        </div>
                                                        <span className={`order-status ${getStatusClass(latestOrder.status)}`}>
                                                            {latestOrder.status || 'Processing'}
                                                        </span>
                                                    </div>

                                                    <div className="recent-update-body">
                                                        <h3>{decodeHTMLEntities(latestOrder.product) || 'Unknown Product'}</h3>
                                                        <div className="recent-update-meta">
                                                            <span className="recent-update-qty">SL: {latestOrder.amount || 1}</span>
                                                            <span className="recent-update-tracking">
                                                                {latestOrder.tracking_number || 'Chờ mã vận đơn'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })()
                                    ) : (
                                        <div className="recent-update-card">
                                            <div className="mobile-empty-state">
                                                <span className="material-symbols-outlined">inbox</span>
                                                <h4>No recent orders</h4>
                                                <p>Add a cookie to start tracking</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Active Orders Section */}
                                    <div className="active-orders-section">
                                        <div className="active-orders-header">
                                            <h2>Active Orders</h2>
                                            <a href="#" onClick={(e) => { e.preventDefault(); setCurrentPage('orders'); }}>
                                                See All
                                            </a>
                                        </div>

                                        {orders.length === 0 ? (
                                            <div className="mobile-empty-state">
                                                <span className="material-symbols-outlined">local_shipping</span>
                                                <h4>No active orders</h4>
                                                <p>Orders will appear here</p>
                                            </div>
                                        ) : (
                                            orders.slice(0, 5).map((order, idx) => (
                                                <div className="mobile-order-card" key={order.id || idx}>
                                                    <div className="mobile-order-img">
                                                        {order.image ? (
                                                            <img
                                                                src={getShopeeImageUrl(order.image)}
                                                                alt="Product"
                                                                onError={(e) => { e.target.style.display = 'none'; }}
                                                            />
                                                        ) : (
                                                            <span className="placeholder">📦</span>
                                                        )}
                                                    </div>
                                                    <div className="mobile-order-info">
                                                        <h4>{decodeHTMLEntities(order.product) || 'Unknown Product'}</h4>
                                                        <p>Tracking: #{order.tracking_number || 'N/A'}</p>
                                                    </div>
                                                    <span className={`order-status ${getStatusClass(order.status)}`}>
                                                        {order.status || 'Processing'}
                                                    </span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </>
                            )}

                            {/* Orders View */}
                            {currentPage === 'orders' && (
                                <div className="active-orders-section">
                                    <p className="mobile-section-title">All Orders ({orders.length})</p>
                                    {orders.length === 0 ? (
                                        <div className="mobile-empty-state">
                                            <span className="material-symbols-outlined">local_shipping</span>
                                            <h4>No orders in transit</h4>
                                            <p>Orders being delivered will appear here</p>
                                        </div>
                                    ) : (
                                        orders.map((order, idx) => (
                                            <div className="mobile-order-card-expanded" key={order.id || idx}>
                                                {/* Header: Image + Product Name + Tracking */}
                                                <div className="mobile-order-header">
                                                    <div className="mobile-order-img">
                                                        {order.image ? (
                                                            <img
                                                                src={getShopeeImageUrl(order.image)}
                                                                alt="Product"
                                                                onError={(e) => { e.target.style.display = 'none'; }}
                                                            />
                                                        ) : (
                                                            <span className="placeholder">📦</span>
                                                        )}
                                                    </div>
                                                    <div className="mobile-order-info">
                                                        <h4>
                                                            {decodeHTMLEntities(order.product) || 'Sản phẩm'}
                                                            <span className="product-quantity"> (SL: {order.amount || 1})</span>
                                                        </h4>
                                                        <p className="tracking-num">#{order.tracking_number || 'Chờ MVD'}</p>
                                                    </div>
                                                </div>

                                                {/* Body: Recipient Info */}
                                                <div className="mobile-order-body">
                                                    <div className="mobile-info-row">
                                                        <div className="mobile-info-group">
                                                            <span className="mobile-info-label">NGƯỜI NHẬN</span>
                                                            <span className="mobile-info-value">{order.shipping?.name || 'N/A'}</span>
                                                        </div>
                                                        <div className="mobile-info-group">
                                                            <span className="mobile-info-label">SỐ ĐIỆN THOẠI</span>
                                                            <span className="mobile-info-value phone">{order.shipping?.phone || 'N/A'}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Journey Section */}
                                                {(order.current_location || order.next_location) && (
                                                    <div className="mobile-journey-section">
                                                        <div className="mobile-journey-header">
                                                            <span className="material-symbols-outlined">route</span>
                                                            <span>DỰ BÁO HÀNH TRÌNH</span>
                                                        </div>
                                                        <div className="mobile-journey-content">
                                                            {order.current_location && (
                                                                <div className="mobile-journey-point">
                                                                    <span className="mobile-journey-label">VỊ TRÍ HIỆN TẠI</span>
                                                                    <span className="mobile-journey-value">{order.current_location}</span>
                                                                </div>
                                                            )}
                                                            {order.next_location && (
                                                                <div className="mobile-journey-point">
                                                                    <span className="mobile-journey-label">
                                                                        {order.current_location ? 'ĐIỂM ĐẾN TIẾP THEO' : 'ĐIỂM ĐẾN'}
                                                                    </span>
                                                                    <span className="mobile-journey-value">{order.next_location}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Status Info Box */}
                                                <div className="mobile-status-info">
                                                    <span className="material-symbols-outlined">info</span>
                                                    <span>{order.status || 'Đang xử lý đơn hàng'}</span>
                                                    {order.status_time && (
                                                        <span className="status-time">
                                                            {new Date(order.status_time * 1000).toLocaleString('vi-VN', {
                                                                hour: '2-digit',
                                                                minute: '2-digit',
                                                                day: '2-digit',
                                                                month: '2-digit'
                                                            })}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Footer: Price */}
                                                <div className="mobile-order-footer">
                                                    <span className="mobile-price-label">TỔNG CỘNG</span>
                                                    <span className="mobile-price-value">{(order.price || 0).toLocaleString()}đ</span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                            {/* Cookies View */}
                            {currentPage === 'cookies' && (
                                <div className="active-orders-section">
                                    <div className="active-orders-header">
                                        <h2>Cookie Management ({cookies.length})</h2>
                                    </div>
                                    {cookies.length === 0 ? (
                                        <div className="mobile-empty-state">
                                            <span className="material-symbols-outlined">cookie</span>
                                            <h4>No cookies</h4>
                                            <p>Add a Shopee cookie to start tracking</p>
                                        </div>
                                    ) : (
                                        cookies.map((c) => (
                                            <div className="mobile-order-card" key={c.id}>
                                                <div className="mobile-order-img">
                                                    <span className="placeholder">🍪</span>
                                                </div>
                                                <div className="mobile-order-info">
                                                    <h4>Cookie #{c.id}</h4>
                                                    <p style={{ fontSize: '0.6rem' }}>{c.cookie?.substring(0, 25)}...</p>
                                                </div>
                                                {c.status === 'pending' && (
                                                    <button
                                                        className="btn btn-primary btn-sm"
                                                        onClick={() => handleCheckCookie(c.id)}
                                                        title="Check cookie"
                                                    >
                                                        <span className="material-symbols-outlined">play_arrow</span>
                                                    </button>
                                                )}
                                                <span className={`mobile-order-status ${c.status === 'active' ? 'in-transit' : c.status === 'pending' ? 'preparing' : 'shipped'}`}>
                                                    {c.status}
                                                </span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                            {/* History View */}
                            {currentPage === 'history' && (
                                <div className="active-orders-section">
                                    <div className="active-orders-header">
                                        <h2>Delivery History</h2>
                                    </div>
                                    <HistoryList onEdit={handleEditDelivered} isMobile={true} />
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* FAB Button */}
                <button className="mobile-fab" onClick={() => setShowAddModal(true)}>
                    <span className="material-symbols-outlined">add</span>
                </button>

                {/* Bottom Navigation */}
                <nav className="bottom-nav">
                    <button
                        className={`bottom-nav-item ${currentPage === 'orders' ? 'active' : ''}`}
                        onClick={() => setCurrentPage('orders')}
                    >
                        <span className="material-symbols-outlined">package_2</span>
                        <span>My Orders</span>
                    </button>
                    <button
                        className={`bottom-nav-item ${currentPage === 'cookies' ? 'active' : ''}`}
                        onClick={() => setCurrentPage('cookies')}
                    >
                        <span className="material-symbols-outlined">cookie</span>
                        <span>Cookies</span>
                    </button>
                    <button
                        className={`bottom-nav-item ${currentPage === 'history' ? 'active' : ''}`}
                        onClick={() => setCurrentPage('history')}
                    >
                        <span className="material-symbols-outlined">history</span>
                        <span>History</span>
                    </button>
                </nav>
            </div>

            {/* Add Cookie Modal */}
            {showAddModal && (
                <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Add New Cookie</h3>
                            <button className="modal-close" onClick={() => setShowAddModal(false)}>
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        <div className="form-group">
                            <label>Shopee Cookie (SPC_ST)</label>
                            <textarea
                                rows={5}
                                placeholder="Paste SPC_ST cookie here..."
                                value={newCookie}
                                onChange={(e) => setNewCookie(e.target.value)}
                            />
                        </div>
                        <p className="modal-hint">
                            ⏳ Cookie sẽ được thêm vào hàng chờ. Nhấn nút ▶ để kích hoạt.
                        </p>
                        <div className="modal-actions">
                            <button className="btn btn-ghost" onClick={() => setShowAddModal(false)}>
                                Cancel
                            </button>
                            <button className="btn btn-primary" onClick={handleAddCookie}>
                                <span className="material-symbols-outlined">add</span>
                                Add Cookie
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Delivered Order Modal */}
            {editingOrder && (
                <div className="modal-overlay" onClick={() => setEditingOrder(null)}>
                    <div className="modal edit-delivered-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Sửa thông tin đơn hàng</h3>
                            <button className="modal-close" onClick={() => setEditingOrder(null)}>
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        <div className="edit-form-grid">
                            <div className="form-group">
                                <label>Tên sản phẩm</label>
                                <input
                                    type="text"
                                    value={editForm.product}
                                    onChange={(e) => setEditForm({ ...editForm, product: e.target.value })}
                                />
                            </div>
                            <div className="form-row-2">
                                <div className="form-group">
                                    <label>Số lượng</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={editForm.amount}
                                        onChange={(e) => setEditForm({ ...editForm, amount: parseInt(e.target.value) || 1 })}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Giá (đ)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={editForm.price}
                                        onChange={(e) => setEditForm({ ...editForm, price: parseInt(e.target.value) || 0 })}
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Mã vận đơn</label>
                                <input
                                    type="text"
                                    value={editForm.tracking_number}
                                    onChange={(e) => setEditForm({ ...editForm, tracking_number: e.target.value })}
                                />
                            </div>
                            <div className="form-divider">
                                <span>Thông tin người nhận</span>
                            </div>
                            <div className="form-row-2">
                                <div className="form-group">
                                    <label>Tên người nhận</label>
                                    <input
                                        type="text"
                                        value={editForm.shipping?.name || ''}
                                        onChange={(e) => setEditForm({
                                            ...editForm,
                                            shipping: { ...editForm.shipping, name: e.target.value }
                                        })}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Số điện thoại</label>
                                    <input
                                        type="text"
                                        value={editForm.shipping?.phone || ''}
                                        onChange={(e) => setEditForm({
                                            ...editForm,
                                            shipping: { ...editForm.shipping, phone: e.target.value }
                                        })}
                                    />
                                </div>
                            </div>

                        </div>
                        <div className="modal-actions">
                            <button className="btn btn-ghost" onClick={() => setEditingOrder(null)}>
                                Hủy
                            </button>
                            <button className="btn btn-primary" onClick={handleSaveEdit}>
                                <span className="material-symbols-outlined">save</span>
                                Lưu thay đổi
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;

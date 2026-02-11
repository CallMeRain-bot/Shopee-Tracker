import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { VirtuosoMasonry } from '@virtuoso.dev/masonry';
import { api } from '../services/api';
import { decodeHTMLEntities } from '../utils';
import LazyImage from './LazyImage';
import OrderSkeleton from './OrderSkeleton';

const INITIAL_LIMIT = 30;
const LOAD_MORE_LIMIT = 15;
const THROTTLE_MS = 300;
const SCROLL_STORAGE_KEY = 'history-scroll-pos';

function throttle(fn, ms) {
    let lastCall = 0;
    return (...args) => {
        const now = Date.now();
        if (now - lastCall >= ms) {
            lastCall = now;
            return fn(...args);
        }
    };
}

export default function HistoryList({ onEdit, onDelete, isMobile = false }) {
    const [orders, setOrders] = useState([]);
    const [nextCursor, setNextCursor] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isError, setIsError] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [total, setTotal] = useState(0);
    const sentinelRef = useRef(null);
    const retryCountRef = useRef(0);
    const containerRef = useRef(null);

    // Fetch history with cursor
    const fetchHistory = useCallback(async (cursor = null, limit = INITIAL_LIMIT) => {
        const isInitial = cursor === null;
        if (isInitial) setIsLoading(true);
        else setIsLoadingMore(true);
        setIsError(false);

        try {
            const data = await api.getHistory(cursor, limit);
            setOrders(prev => isInitial ? data.orders : [...prev, ...data.orders]);
            setNextCursor(data.nextCursor);
            setHasMore(data.hasMore);
            setTotal(data.total);
            retryCountRef.current = 0;
        } catch (e) {
            console.error('History fetch error:', e);
            // Auto-retry once
            if (retryCountRef.current < 1) {
                retryCountRef.current++;
                setTimeout(() => fetchHistory(cursor, limit), 1000);
                return;
            }
            setIsError(true);
        } finally {
            setIsLoading(false);
            setIsLoadingMore(false);
        }
    }, []);

    // Initial load
    useEffect(() => {
        fetchHistory(null, INITIAL_LIMIT);
    }, [fetchHistory]);

    // Throttled loadMore
    const loadMore = useMemo(() =>
        throttle(() => {
            if (!isLoadingMore && hasMore && nextCursor && !isError) {
                fetchHistory(nextCursor, LOAD_MORE_LIMIT);
            }
        }, THROTTLE_MS),
        [isLoadingMore, hasMore, nextCursor, isError, fetchHistory]
    );

    // Intersection Observer for sentinel
    useEffect(() => {
        if (!hasMore || isLoading || isLoadingMore) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) loadMore();
            },
            { threshold: 0.1, rootMargin: '200px' }
        );

        const el = sentinelRef.current;
        if (el) observer.observe(el);
        return () => observer.disconnect();
    }, [hasMore, isLoading, isLoadingMore, loadMore]);

    // Scroll restoration - save position
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleScroll = throttle(() => {
            sessionStorage.setItem(SCROLL_STORAGE_KEY, String(container.scrollTop));
        }, 200);

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, []);

    // Scroll restoration - restore position
    useEffect(() => {
        if (isLoading || orders.length === 0) return;
        const saved = sessionStorage.getItem(SCROLL_STORAGE_KEY);
        if (saved && containerRef.current) {
            requestAnimationFrame(() => {
                containerRef.current.scrollTop = parseInt(saved);
            });
        }
    }, [isLoading, orders.length]);

    // Refresh all (for edit/delete)
    const refreshAll = useCallback(() => {
        setOrders([]);
        setNextCursor(null);
        setHasMore(true);
        sessionStorage.removeItem(SCROLL_STORAGE_KEY);
        fetchHistory(null, INITIAL_LIMIT);
    }, [fetchHistory]);

    const handleEdit = useCallback((order) => {
        if (onEdit) onEdit(order, refreshAll);
    }, [onEdit, refreshAll]);

    const handleDelete = useCallback(async (orderId) => {
        if (!confirm('Xóa đơn hàng này khỏi lịch sử?')) return;
        try {
            await api.deleteDeliveredOrder(orderId);
            setOrders(prev => prev.filter(o => o.id !== orderId));
            setTotal(prev => prev - 1);
        } catch (e) {
            console.error('Delete delivered error:', e);
            alert('❌ Lỗi xóa: ' + e.message);
        }
    }, []);

    // Desktop card renderer
    const DesktopCard = useCallback(({ data: order }) => (
        <div className="order-card delivered-card" style={{ margin: '6px' }}>
            <div className="order-card-header">
                <div className="order-card-product-img">
                    <LazyImage imageId={order.image} />
                </div>
                <div className="order-card-product-info">
                    <h4 className="order-card-product-name">
                        {decodeHTMLEntities(order.product) || ''}
                        <span className="product-quantity"> (SL: {order.amount || 1})</span>
                    </h4>
                    <div className="order-card-tracking">
                        <span className="tracking-code">{order.tracking_number || ''}</span>
                        {order.tracking_number && (
                            <>
                                <button
                                    className="copy-btn"
                                    onClick={() => navigator.clipboard.writeText(order.tracking_number || '')}
                                    title="Copy mã vận đơn"
                                >
                                    <span className="material-symbols-outlined">content_copy</span>
                                </button>
                                <a
                                    href={`https://tramavandon.com/spx/?tracking_number=${order.tracking_number}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="copy-btn"
                                    title="Tra cứu vận đơn"
                                >
                                    <span className="material-symbols-outlined">open_in_new</span>
                                </a>
                            </>
                        )}
                    </div>
                </div>
            </div>

            <div className="order-card-body">
                <div className="order-card-info-row">
                    <div className="info-column">
                        <div className="info-group">
                            <span className="info-label">NGƯỜI NHẬN</span>
                            <span className="info-value">{order.shipping?.name || 'N/A'}</span>
                        </div>
                        <div className="info-group">
                            <span className="info-label">SỐ ĐIỆN THOẠI</span>
                            <span className="info-value phone-value">{order.shipping?.phone || 'N/A'}</span>
                        </div>
                    </div>
                    <div className="info-column status-column">
                        <div className="info-group">
                            <div className="info-label-row">
                                <span className="info-label">TRẠNG THÁI</span>
                                <span className="material-symbols-outlined info-icon status-icon-small">check_circle</span>
                            </div>
                            <span className="info-value status-text-wrap delivered-status-text">{order.status || 'Giao hàng thành công'}</span>
                        </div>
                        {order.delivered_at && (
                            <div className="info-group">
                                <span className="info-label">GIAO LÚC</span>
                                <span className="info-value">
                                    {new Date(order.delivered_at).toLocaleString('vi-VN', {
                                        hour: '2-digit', minute: '2-digit',
                                        day: '2-digit', month: '2-digit'
                                    })}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="order-card-footer">
                <div className="order-card-price">
                    <span className="price-label">TỔNG CỘNG</span>
                    <span className="price-value">{(order.price || 0).toLocaleString()}đ</span>
                </div>
                <div className="delivered-footer-right">
                    {order.delivered_at && (
                        <span className="updated-at delivered-time">
                            {new Date(order.delivered_at).toLocaleString('vi-VN', {
                                day: '2-digit', month: '2-digit',
                                hour: '2-digit', minute: '2-digit'
                            })}
                        </span>
                    )}
                    <div className="delivered-actions">
                        <button className="btn-icon edit-btn" onClick={() => handleEdit(order)} title="Sửa thông tin">
                            <span className="material-symbols-outlined">edit</span>
                        </button>
                        <button className="btn-icon delete-btn" onClick={() => handleDelete(order.id)} title="Xóa">
                            <span className="material-symbols-outlined">delete</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    ), [handleEdit, handleDelete]);

    // Mobile card renderer
    const MobileCard = useCallback(({ data: order }) => (
        <div className="mobile-order-card-expanded delivered-card" style={{ marginBottom: '12px' }}>
            <div className="mobile-order-header">
                <div className="mobile-order-img">
                    <LazyImage imageId={order.image} />
                </div>
                <div className="mobile-order-info">
                    <h4>
                        {decodeHTMLEntities(order.product) || 'Sản phẩm'}
                        <span className="product-quantity"> (SL: {order.amount || 1})</span>
                    </h4>
                    <p className="tracking-num">#{order.tracking_number || 'N/A'}</p>
                </div>
            </div>

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

            <div className="mobile-status-info delivered-status">
                <span className="material-symbols-outlined">check_circle</span>
                <span>{order.status || 'Giao hàng thành công'}</span>
            </div>

            <div className="mobile-order-footer">
                <span className="mobile-price-label">TỔNG CỘNG</span>
                <span className="mobile-price-value">{(order.price || 0).toLocaleString()}đ</span>
                {order.delivered_at && (
                    <span className="delivered-time">
                        {new Date(order.delivered_at).toLocaleString('vi-VN', {
                            day: '2-digit', month: '2-digit',
                            hour: '2-digit', minute: '2-digit'
                        })}
                    </span>
                )}
                <div className="delivered-actions">
                    <button className="btn-icon edit-btn" onClick={() => handleEdit(order)} title="Sửa thông tin">
                        <span className="material-symbols-outlined">edit</span>
                    </button>
                    <button className="btn-icon delete-btn" onClick={() => handleDelete(order.id)} title="Xóa">
                        <span className="material-symbols-outlined">delete</span>
                    </button>
                </div>
            </div>
        </div>
    ), [handleEdit, handleDelete]);

    // Loading state
    if (isLoading) {
        return <OrderSkeleton count={isMobile ? 3 : 6} />;
    }

    // Empty state
    if (orders.length === 0 && !isLoading) {
        return (
            <div className={isMobile ? 'mobile-empty-state' : 'empty-state'}>
                <span className="material-symbols-outlined icon">inventory_2</span>
                <h4>No delivery history</h4>
                <p>Completed orders will appear here</p>
            </div>
        );
    }

    // Desktop: Virtualized Masonry
    if (!isMobile) {
        return (
            <div ref={containerRef} className="tab-scroll-container">
                <VirtuosoMasonry
                    columnCount={3}
                    data={orders}
                    initialItemCount={Math.min(orders.length, 20)}
                    ItemContent={DesktopCard}
                    useWindowScroll={false}
                    scrollerRef={(el) => {
                        if (containerRef.current !== el && el) containerRef.current = el;
                    }}
                />

                {/* Sentinel + Loading states */}
                <div ref={sentinelRef} className="scroll-sentinel">
                    {isLoadingMore && <div className="mini-spinner" />}
                    {isError && (
                        <div className="error-retry-box">
                            <p>⚠️ Lỗi kết nối</p>
                            <button onClick={() => fetchHistory(nextCursor, LOAD_MORE_LIMIT)}>Thử lại</button>
                        </div>
                    )}
                    {!hasMore && orders.length > 0 && (
                        <p className="end-of-list">🎉 Đã xem hết {total} đơn hàng!</p>
                    )}
                </div>
            </div>
        );
    }

    // Mobile: Simple list (no masonry needed)
    return (
        <div ref={containerRef}>
            {orders.map((order, idx) => (
                <MobileCard key={order.id || idx} data={order} />
            ))}

            <div ref={sentinelRef} className="scroll-sentinel">
                {isLoadingMore && <div className="mini-spinner" />}
                {isError && (
                    <div className="error-retry-box">
                        <p>⚠️ Lỗi kết nối</p>
                        <button onClick={() => fetchHistory(nextCursor, LOAD_MORE_LIMIT)}>Thử lại</button>
                    </div>
                )}
                {!hasMore && orders.length > 0 && (
                    <p className="end-of-list">🎉 Đã xem hết {total} đơn hàng!</p>
                )}
            </div>
        </div>
    );
}

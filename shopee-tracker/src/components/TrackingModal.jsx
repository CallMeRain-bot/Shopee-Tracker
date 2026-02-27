import { useState, useEffect } from 'react';
import { api } from '../services/api';
import '../tracking.css';

const TrackingModal = ({ trackingNumber, onClose }) => {
    const [journey, setJourney] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchTracking = async () => {
            try {
                const data = await api.getTracking(trackingNumber);
                if (data && data.records) {
                    setJourney(data.records);
                }
            } catch (e) {
                console.error('Error fetching tracking:', e);
            } finally {
                setLoading(false);
            }
        };

        if (trackingNumber) fetchTracking();
    }, [trackingNumber]);

    return (
        <div className="modal-overlay liquid-glass-overlay" onClick={onClose}>
            <div className="modal tracking-modal liquid-glass-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <h3>Hành trình đơn hàng</h3>
                        <p className="tracking-id-label">{trackingNumber}</p>
                    </div>
                    <button className="modal-close" onClick={onClose}>
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="modal-body tracking-body">
                    {loading ? (
                        <div className="tracking-loading">
                            <div className="spinner"></div>
                            <p>Đang tải hành trình...</p>
                        </div>
                    ) : (journey && journey.length > 0) ? (
                        <div className="tracking-timeline">
                            {journey.map((step, index) => (
                                <div className={`timeline-item ${index === 0 ? 'latest' : ''}`} key={index}>
                                    <div className="timeline-marker">
                                        <div className="marker-dot"></div>
                                        {index !== journey.length - 1 && <div className="marker-line"></div>}
                                    </div>
                                    <div className="timeline-content">
                                        <div className="timeline-header">
                                            <span className="timeline-time">
                                                {new Date(step.actual_time * 1000).toLocaleString('vi-VN', {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                    day: '2-digit',
                                                    month: '2-digit',
                                                    year: 'numeric'
                                                })}
                                            </span>
                                            <span className="timeline-status-name">{step.tracking_name}</span>
                                        </div>
                                        <p className="timeline-desc">{step.buyer_description}</p>
                                        {(step.current_location?.location_name || step.next_location?.location_name) && (
                                            <div className="timeline-locations">
                                                {step.current_location?.location_name && (
                                                    <div className="location-tag current">
                                                        <span className="material-symbols-outlined">location_on</span>
                                                        <span>{step.current_location.location_name}</span>
                                                    </div>
                                                )}
                                                {step.next_location?.location_name && (
                                                    <div className="location-tag next">
                                                        <span className="material-symbols-outlined">arrow_forward</span>
                                                        <span>{step.next_location.location_name}</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="tracking-empty">
                            <span className="material-symbols-outlined">sentiment_dissatisfied</span>
                            <p>Không tìm thấy dữ liệu hành trình cho vận đơn này.</p>
                            <p className="empty-sub">Có thể đơn hàng vừa mới được tạo hoặc carrier chưa cập nhật kịp.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TrackingModal;

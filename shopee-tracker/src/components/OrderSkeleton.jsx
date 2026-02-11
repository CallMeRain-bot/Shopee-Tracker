export default function OrderSkeleton({ count = 6 }) {
    return (
        <div className="skeleton-grid">
            {Array.from({ length: count }).map((_, i) => (
                <div className="skeleton-card" key={i}>
                    <div className="skeleton-header">
                        <div className="skeleton-img shimmer" />
                        <div className="skeleton-text-group">
                            <div className="skeleton-line w-80 shimmer" />
                            <div className="skeleton-line w-50 shimmer" />
                        </div>
                    </div>
                    <div className="skeleton-body">
                        <div className="skeleton-line w-60 shimmer" />
                        <div className="skeleton-line w-40 shimmer" />
                    </div>
                    <div className="skeleton-footer">
                        <div className="skeleton-line w-30 shimmer" />
                        <div className="skeleton-line w-20 shimmer" />
                    </div>
                </div>
            ))}
        </div>
    );
}

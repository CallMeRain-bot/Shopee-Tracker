import { useState, useCallback } from 'react';
import { getShopeeImageUrl } from '../utils';



export default function LazyImage({ imageId, alt = 'Product', className = '' }) {
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);

    const src = getShopeeImageUrl(imageId);

    const handleLoad = useCallback(() => setLoaded(true), []);
    const handleError = useCallback(() => { setError(true); setLoaded(true); }, []);

    if (!src || error) {
        return <span className="placeholder">📦</span>;
    }

    return (
        <div className={`lazy-img-wrapper ${className}`}>
            {!loaded && <div className="lazy-img-skeleton" />}
            <img
                src={src}
                alt={alt}
                loading="lazy"
                className={`lazy-img ${loaded ? 'loaded' : ''}`}
                onLoad={handleLoad}
                onError={handleError}
            />
        </div>
    );
}

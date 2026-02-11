/**
 * Rate Limiting Middleware
 * Prevents brute force attacks by limiting requests per IP
 */

// In-memory store for rate limiting (simple implementation)
// In production, use Redis for distributed environments
const rateLimitStore = new Map();

// Clean up expired entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimitStore.entries()) {
        if (now > value.resetTime) {
            rateLimitStore.delete(key);
        }
    }
}, 5 * 60 * 1000);

/**
 * Create rate limiter middleware
 * @param {Object} options
 * @param {number} options.maxRequests - Maximum requests allowed
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {string} options.message - Error message when rate limited
 */
const createRateLimiter = ({
    maxRequests = 5,
    windowMs = 15 * 60 * 1000, // 15 minutes
    message = 'Too many requests, please try again later'
} = {}) => {
    return (req, res, next) => {
        // Get client IP
        const ip = req.ip ||
            req.headers['x-forwarded-for']?.split(',')[0] ||
            req.connection.remoteAddress ||
            'unknown';

        const key = `${ip}:${req.path}`;
        const now = Date.now();

        let record = rateLimitStore.get(key);

        if (!record || now > record.resetTime) {
            // First request or window expired
            record = {
                count: 1,
                resetTime: now + windowMs
            };
            rateLimitStore.set(key, record);

            // Set rate limit headers
            res.setHeader('X-RateLimit-Limit', maxRequests);
            res.setHeader('X-RateLimit-Remaining', maxRequests - 1);
            res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

            return next();
        }

        record.count++;

        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - record.count));
        res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

        if (record.count > maxRequests) {
            const retryAfter = Math.ceil((record.resetTime - now) / 1000);
            res.setHeader('Retry-After', retryAfter);

            return res.status(429).json({
                error: 'Too Many Requests',
                message: message,
                retryAfter: retryAfter
            });
        }

        next();
    };
};

// Pre-configured rate limiters
const loginRateLimiter = createRateLimiter({
    maxRequests: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
    message: 'Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau 15 phút.'
});

const apiRateLimiter = createRateLimiter({
    maxRequests: 100,
    windowMs: 60 * 1000, // 1 minute
    message: 'Quá nhiều requests. Vui lòng chậm lại.'
});

module.exports = {
    createRateLimiter,
    loginRateLimiter,
    apiRateLimiter
};

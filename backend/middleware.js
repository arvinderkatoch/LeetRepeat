/**
 * Middleware utilities for production-ready backend
 */

const { logger } = require("./errorHandler");

/**
 * Request logging middleware
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();

  // Log response when sent
  const originalJson = res.json;
  res.json = function (data) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    logger.info(`${req.method} ${req.path}`, {
      statusCode,
      duration: `${duration}ms`,
      userId: req.user?.userId,
      query: req.query,
    });

    return originalJson.call(this, data);
  };

  next();
}

/**
 * Request timeout middleware
 * Prevents slow queries from hanging connections
 */
function requestTimeout(timeoutMs = 30000) {
  return (req, res, next) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({ error: "Request timeout" });
      }
    }, timeoutMs);

    res.on("finish", () => clearTimeout(timeout));
    next();
  };
}

/**
 * Rate limiting middleware (simple in-memory implementation)
 * For production, use redis-based rate limiter
 */
const createRateLimiter = (maxRequests = 100, windowMs = 60000) => {
  const clientRequests = new Map();

  return (req, res, next) => {
    const clientId = req.user?.userId || req.ip;
    const now = Date.now();
    const window = now - windowMs;

    if (!clientRequests.has(clientId)) {
      clientRequests.set(clientId, []);
    }

    // Clean old requests
    const requests = clientRequests.get(clientId).filter((t) => t > window);
    requests.push(now);
    clientRequests.set(clientId, requests);

    if (requests.length > maxRequests) {
      return res.status(429).json({
        error: "Too many requests. Please try again later.",
      });
    }

    next();
  };
};

/**
 * Input validation helpers
 */
const validators = {
  isEmail: (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
  },

  isUrl: (url) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },

  isValidDifficulty: (diff) => ["Easy", "Medium", "Hard"].includes(diff),

  isPositiveInteger: (num) => Number.isInteger(Number(num)) && Number(num) >= 0,

  isBetween: (num, min, max) => {
    const n = Number(num);
    return Number.isFinite(n) && n >= min && n <= max;
  },
};

module.exports = {
  requestLogger,
  requestTimeout,
  createRateLimiter,
  validators,
};

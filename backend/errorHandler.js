/**
 * Error Handler Utility
 * Prevents stack traces from leaking in production
 * Provides structured error responses
 */

class AppError extends Error {
  constructor(message, statusCode = 500, context = {}) {
    super(message);
    this.statusCode = statusCode;
    this.context = context;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Logger utility - logs errors server-side without exposing details to clients
 */
const logger = {
  error: (msg, err, context = {}) => {
    // In production, log to external service (e.g., Sentry, LogRocket)
    // For now, use console.error to stderr
    if (process.env.NODE_ENV !== "production") {
      console.error(`[ERROR] ${msg}`, {
        message: err?.message,
        stack: err?.stack,
        code: err?.code,
        ...context,
      });
    } else {
      // In production, log less verbose
      console.error(`[ERROR] ${msg}:`, err?.code || err?.message);
    }
  },
  warn: (msg, context = {}) => {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[WARN] ${msg}`, context);
    }
  },
  info: (msg, context = {}) => {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[INFO] ${msg}`, context);
    }
  },
};

/**
 * Error response formatter
 * Always returns generic messages to clients in production
 */
function formatErrorResponse(err, isDevelopment = false) {
  // Map Supabase errors to user-friendly messages
  const errorMap = {
    23505: { message: "Resource already exists", statusCode: 409 },
    23503: { message: "Invalid reference or foreign key", statusCode: 400 },
    42P01: { message: "Resource not found", statusCode: 404 },
    "auth/invalid-id-token": { message: "Invalid authentication token", statusCode: 401 },
  };

  // Check if this is a known error type
  if (err.code && errorMap[err.code]) {
    return {
      error: errorMap[err.code].message,
      statusCode: errorMap[err.code].statusCode,
    };
  }

  // If it's our AppError, return as-is
  if (err instanceof AppError) {
    return {
      error: err.message,
      statusCode: err.statusCode,
      ...(isDevelopment && { contextInfo: err.context }),
    };
  }

  // For unexpected errors, return generic message
  return {
    error: isDevelopment ? err.message : "An error occurred. Please try again.",
    statusCode: 500,
    ...(isDevelopment && { stack: err.stack }),
  };
}

/**
 * Express error handler middleware
 * Should be last middleware in the app
 */
function errorHandler(err, req, res, next) {
  const isDevelopment = process.env.NODE_ENV !== "production";

  // Log the error server-side
  logger.error(`${req.method} ${req.path}`, err, {
    userId: req.user?.userId,
    body: req.body,
  });

  const response = formatErrorResponse(err, isDevelopment);

  return res.status(response.statusCode || 500).json({
    error: response.error,
    ...(isDevelopment && {
      code: err.code,
      contextInfo: response.contextInfo,
      stack: response.stack,
    }),
  });
}

/**
 * Async route wrapper to catch errors
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Input validation error
 */
class ValidationError extends AppError {
  constructor(message, fields = []) {
    super(message, 400, { fields });
  }
}

/**
 * Authorization error
 */
class AuthError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401);
  }
}

/**
 * Not found error
 */
class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, 404);
  }
}

/**
 * Conflict error (e.g., duplicate key)
 */
class ConflictError extends AppError {
  constructor(message) {
    super(message, 409);
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthError,
  NotFoundError,
  ConflictError,
  logger,
  errorHandler,
  asyncHandler,
  formatErrorResponse,
};

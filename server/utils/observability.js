/* ============================================================
   OBSERVABILITY  (Market-Readiness Gap Sprint, Phase 5)
   ------------------------------------------------------------
   - requestIdMiddleware: attaches a stable per-request id, echoes it in
     the X-Request-Id response header, and exposes a child log helper so
     route logs can carry the id without a logging-library dependency.
   - createErrorHandler: drop-in replacement for the final Express error
     handler. Same response contract as before (status, error,
     message), PLUS structured logging with the request id and a
     best-effort persist into the capped error_logs collection.
   Both are dependency-free and safe with the DB off.
   ============================================================ */
import crypto from 'node:crypto';

export function requestIdMiddleware() {
  return (req, res, next) => {
    // Honor an upstream id (load balancer / client retries) but bound it.
    const incoming = String(req.headers['x-request-id'] || '').slice(0, 64);
    const id = /^[a-zA-Z0-9._-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}

/* Final error handler. logger follows ./logger.js, db follows ./db.js;
   both optional so unit tests can pass fakes. */
export function createErrorHandler({ logger, db = null, isProd = false } = {}) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    const entry = {
      requestId: req.requestId || '',
      method: req.method,
      path: req.path,
      status: safeStatus,
      message: err.message,
    };
    logger?.error?.('Unhandled request error', { ...entry, stack: isProd ? undefined : err.stack });
    // Persist best-effort: never let logging failures affect the response.
    if (db?.dbEnabled?.()) {
      Promise.resolve(db.saveErrorLog({
        ...entry,
        stack: err.stack || '',
        userEmail: (req.user && req.user.email) || '',
      })).catch(() => {});
    }
    if (res.headersSent) return;
    res.status(safeStatus).json({
      error: 'server_error',
      requestId: req.requestId || undefined,
      message: isProd
        ? 'Something went wrong on our end. Please try again.'
        : err.message || 'Internal server error',
    });
  };
}

export default { requestIdMiddleware, createErrorHandler };

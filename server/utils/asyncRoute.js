/* ============================================================
   ASYNC ROUTE SAFETY  —  the single highest-severity fix.
   ------------------------------------------------------------
   Express 4 does NOT catch rejections from `async (req, res)`
   handlers. Today this codebase registers 100+ async handlers
   with NO try/catch (collegeRoutes.js: 39 handlers / 0 try
   blocks; teamProjectRoutes.js: 13 / 0; projectIntelligence:
   16 / 1; problemIntelligence: 29 / 4).

   Consequence on Node 18+ (default --unhandled-rejections=throw):
   ONE throw inside any of those handlers becomes an unhandled
   rejection and TERMINATES THE PROCESS. On a long-running host
   (Render/EC2/a college VM) that is a hard outage for every
   user. On Vercel it kills the invocation and the client sees a
   hung request. This is the "Project engine crashed while going
   through flow" review.

   Usage — three lines in server.js:

     import { asyncRoute, installProcessGuards, errorMiddleware }
       from './server/utils/asyncRoute.js';

     installProcessGuards(logger);        // BEFORE routes
     ... register all routes ...
     app.use(errorMiddleware(logger));    // AFTER all routes,
                                          // before the 404 catch-all

   Then wrap handlers. Two options:
     a) Per-handler:  app.get('/x', asyncRoute(async (req,res)=>{...}))
     b) Bulk, zero edits to route files:  patchAppAsync(app)
        — monkey-patches app.get/post/put/patch/delete so every
        async handler registered AFTER the call is auto-wrapped.
        Call it immediately after `const app = express()`.
   ============================================================ */

/** Wrap one handler so a rejected promise goes to next(err) instead of crashing. */
export function asyncRoute(fn) {
  if (typeof fn !== 'function') return fn;
  if (fn.__asyncWrapped) return fn;
  const wrapped = function (req, res, next) {
    try {
      const out = fn.call(this, req, res, next);
      if (out && typeof out.then === 'function') out.catch(next);
      return out;
    } catch (err) {
      next(err);
      return undefined;
    }
  };
  wrapped.__asyncWrapped = true;
  // Preserve arity-4 error middleware signatures untouched.
  return fn.length >= 4 ? fn : wrapped;
}

const VERBS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];

/**
 * Monkey-patch an Express app (or Router) so every handler registered from
 * this point on is wrapped. This is the zero-diff path: it fixes all 100+
 * existing handlers without touching a single route file.
 */
export function patchAppAsync(app) {
  if (!app || app.__asyncPatched) return app;
  for (const verb of VERBS) {
    const original = app[verb];
    if (typeof original !== 'function') continue;
    app[verb] = function (...args) {
      return original.apply(
        this,
        args.map((a) => (typeof a === 'function' ? asyncRoute(a) : a)),
      );
    };
  }
  app.__asyncPatched = true;
  return app;
}

/**
 * Process-level backstop. Even with every handler wrapped, a rejection can
 * escape from a timer, a stream, or a fire-and-forget call. Log it loudly and
 * KEEP SERVING — a degraded response beats a dead process during a college
 * demo. Genuine uncaughtExceptions still exit (the process state is unsafe),
 * but only after the reason is logged, and with a delay so the log flushes.
 */
export function installProcessGuards(logger = console, { exitOnUncaught = true } = {}) {
  if (globalThis.__caProcessGuards) return;
  globalThis.__caProcessGuards = true;

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    (logger.error || console.error).call(logger, 'Unhandled promise rejection (kept alive)', {
      message: err.message,
      stack: String(err.stack || '').split('\n').slice(0, 6).join('\n'),
    });
  });

  process.on('uncaughtException', (err) => {
    (logger.error || console.error).call(logger, 'Uncaught exception', {
      message: err?.message,
      stack: String(err?.stack || '').split('\n').slice(0, 6).join('\n'),
    });
    if (exitOnUncaught) setTimeout(() => process.exit(1), 250).unref();
  });
}

/**
 * Terminal error middleware. Mount AFTER every route and BEFORE the
 * `app.use(['/jobs','/auth',...])` 404 catch-all in server.js.
 * Never leaks stacks or messages to the client in production; always emits a
 * requestId so a student's screenshot maps to a server log line.
 */
export function errorMiddleware(logger = console, { isProd = process.env.NODE_ENV === 'production' } = {}) {
  return function (err, req, res, _next) {
    const requestId = req.id || req.headers['x-request-id'] || null;
    const status = Number(err?.status || err?.statusCode) || 500;

    (logger.error || console.error).call(logger, 'Request failed', {
      requestId,
      method: req.method,
      path: req.path,
      status,
      message: err?.message,
      stack: isProd ? undefined : String(err?.stack || '').split('\n').slice(0, 8).join('\n'),
    });

    if (res.headersSent) return;

    res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error: status === 404 ? 'not_found' : 'internal_error',
      message: isProd
        ? 'Something went wrong on our side. Please retry — if it keeps happening, share the reference below with support.'
        : String(err?.message || err),
      requestId,
    });
  };
}

export default { asyncRoute, patchAppAsync, installProcessGuards, errorMiddleware };

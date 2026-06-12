/* ============================================================
   Routes — Ops & Account  (/api/health, /api/ready,
   /api/admin/errors, /api/account/export, /api/account)
   ------------------------------------------------------------
   Phase 5 of the Market-Readiness Gap Sprint. The legacy /health and
   /health/db endpoints are untouched; /api/health and /api/ready are the
   load-balancer-friendly additions (ready actually pings Mongo).
   ============================================================ */

export function registerOpsRoutes(app, deps = {}) {
  const { requireAuth, requireAdmin, currentUser, db = null, logger = null } = deps;
  if (!requireAuth || !currentUser) throw new Error('opsRoutes: requireAuth + currentUser required');

  const userOf = (req) => {
    const u = currentUser(req) || {};
    return { userId: u.id || u._id || '', email: u.email || '' };
  };

  /* ============ GET /api/health — liveness (never touches the DB) ============ */
  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      requestId: req.requestId || null,
      db: db?.dbEnabled?.() ? 'configured' : 'off',
      ai: !!process.env.ANTHROPIC_API_KEY,
      degraded: { db: !db?.dbEnabled?.(), ai: !process.env.ANTHROPIC_API_KEY },
      time: new Date().toISOString(),
    });
  });

  /* ============ GET /api/ready — readiness (real DB ping) ============ */
  app.get('/api/ready', async (req, res) => {
    if (!db?.dbEnabled?.()) {
      // DB intentionally off → the app is ready in degraded (local-first) mode.
      return res.json({ ok: true, db: 'off', degraded: true, time: new Date().toISOString() });
    }
    try {
      await db.connectDB();
      res.json({ ok: true, db: 'connected', degraded: false, time: new Date().toISOString() });
    } catch (e) {
      res.status(503).json({ ok: false, db: 'unreachable', degraded: true, message: e.message });
    }
  });

  /* ============ GET /api/admin/errors — paginated error feed ============ */
  if (requireAdmin) {
    app.get('/api/admin/errors', requireAuth, requireAdmin, async (req, res) => {
      const page = Number(req.query.page) || 1;
      const pageSize = Number(req.query.pageSize) || 50;
      const result = await db?.listErrorLogs?.({ page, pageSize }) || { ok: false, reason: 'db_off', errors: [], total: 0 };
      res.json({ ...result, db: db?.dbEnabled?.() || false });
    });
  }

  /* ============ GET /api/account/export — DPDP full data export ============ */
  app.get('/api/account/export', requireAuth, async (req, res) => {
    try {
      if (!db?.dbEnabled?.()) {
        return res.json({
          ok: true, db: 'off',
          message: 'No server-side data is stored for this account (database disabled). Your data lives only in this browser.',
          collections: {},
        });
      }
      const result = await db.exportUserData(userOf(req));
      res.setHeader('Content-Disposition', 'attachment; filename="career-autopilot-export.json"');
      res.json(result);
    } catch (err) {
      logger?.error?.('Account export failed', { message: err.message });
      res.status(500).json({ ok: false, error: 'export_failed' });
    }
  });

  /* ============ DELETE /api/account — soft delete + 7-day grace ============
     Requires the explicit confirmation body { confirm: 'DELETE' } so a
     stray client call can never schedule a deletion. Signing back in
     during the grace window cancels it (handled in db.upsertUser). The
     expired-deletion sweep also runs here, piggybacked, so no cron is
     required for the cascade to eventually happen. */
  app.delete('/api/account', requireAuth, async (req, res) => {
    try {
      if (String(req.body?.confirm || req.query?.confirm || '') !== 'DELETE') {
        return res.status(400).json({
          ok: false, error: 'confirmation_required',
          message: 'Send { "confirm": "DELETE" } to schedule account deletion. You have a 7-day grace window; signing back in cancels it.',
        });
      }
      if (!db?.dbEnabled?.()) {
        return res.json({ ok: true, db: 'off', message: 'No server-side data to delete (database disabled). Clear this browser\'s site data to remove local copies.' });
      }
      const result = await db.softDeleteAccount(userOf(req));
      // Opportunistic sweep of accounts whose grace window already expired.
      db.purgeExpiredDeletions({ limit: 5 }).catch(() => {});
      // End this session: the account is now scheduled for deletion.
      if (result.ok && req.session) { try { req.session.destroy(() => {}); } catch { /* noop */ } }
      res.json(result);
    } catch (err) {
      logger?.error?.('Account delete failed', { message: err.message });
      res.status(500).json({ ok: false, error: 'delete_failed' });
    }
  });
}

export default { registerOpsRoutes };

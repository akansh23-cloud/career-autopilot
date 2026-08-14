/* ============================================================
   JOB DISCOVERY OS — BOUNDED BROWSER POOL  (§12)
   ------------------------------------------------------------
   Playwright is already a dependency of the resume renderer. This
   is a SEPARATE pool: crawling must never contend with, starve or
   crash the render path.

   Guarantees:
     - ONE Chromium process for the whole crawler, reused
     - bounded page concurrency (never one browser per URL)
     - per-host concurrency delegated to the shared RateController
     - navigation timeout + hard page budget
     - request interception blocks media/analytics/ads, and NEVER
       blocks the resources that produce the job content
     - every navigation target and redirect re-validated for SSRF
     - idle shutdown so a quiet deployment holds no Chromium

   Playwright is imported LAZILY. On a deployment without it the
   pool reports available=false and the crawler simply skips the
   browser stage — it never pretends the fallback ran.
   ============================================================ */

import { assertUrlAllowed } from './ssrf.js';
import { Semaphore } from './rateControl.js';
import { ERROR_CLASS } from '../schema.js';
import { USER_AGENT } from './robots.js';

/* Blocked because they never carry job content. Scripts, XHR, fetch and
   documents are DELIBERATELY not blocked — a JS-rendered board needs them. */
export const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'websocket']);

export const BLOCKED_URL_PATTERNS = [
  /googletagmanager\.com/i, /google-analytics\.com/i, /analytics\.google\.com/i,
  /doubleclick\.net/i, /facebook\.net/i, /facebook\.com\/tr/i,
  /hotjar\.com/i, /fullstory\.com/i, /segment\.(io|com)/i, /mixpanel\.com/i,
  /amplitude\.com/i, /intercom\.(io|com)/i, /clarity\.ms/i, /adsystem\./i,
  /adservice\./i, /criteo\./i, /taboola\./i, /outbrain\./i, /\.mp4($|\?)/i,
  /\.webm($|\?)/i, /\.mov($|\?)/i,
];

export class BrowserPool {
  constructor({
    maxPages = 2,
    navigationTimeoutMs = 20_000,
    pageBudgetMs = 30_000,
    idleShutdownMs = 120_000,
    launchArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    playwrightLoader = null,
    userAgent = USER_AGENT,
    resolver = undefined,
  } = {}) {
    this.maxPages = maxPages;
    this.navigationTimeoutMs = navigationTimeoutMs;
    this.pageBudgetMs = pageBudgetMs;
    this.idleShutdownMs = idleShutdownMs;
    this.launchArgs = launchArgs;
    this.userAgent = userAgent;
    this.resolver = resolver;
    this.sem = new Semaphore(maxPages);
    this.playwrightLoader = playwrightLoader || (() => import('playwright'));
    this.browser = null;
    this.launching = null;
    this.idleTimer = null;
    this.available = null; // null = not yet probed
    this.metrics = { renders: 0, failures: 0, blockedRequests: 0, launches: 0 };
  }

  async probe() {
    if (this.available !== null) return this.available;
    try {
      const pw = await this.playwrightLoader();
      this.available = !!(pw?.chromium);
      this._pw = pw;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async ensureBrowser() {
    if (this.browser) return this.browser;
    if (this.launching) return this.launching;
    this.launching = (async () => {
      const ok = await this.probe();
      if (!ok) throw Object.assign(new Error('Playwright is not installed on this deployment'), { errorClass: ERROR_CLASS.NOT_CONFIGURED });
      this.metrics.launches += 1;
      this.browser = await this._pw.chromium.launch({ headless: true, args: this.launchArgs });
      this.browser.on('disconnected', () => { this.browser = null; });
      return this.browser;
    })();
    try { return await this.launching; } finally { this.launching = null; }
  }

  touchIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { this.close().catch(() => {}); }, this.idleShutdownMs);
    if (typeof this.idleTimer.unref === 'function') this.idleTimer.unref();
  }

  /**
   * Render one URL and return its HTML. Bounded by the page semaphore, the
   * navigation timeout and the overall page budget.
   */
  async render(url, { waitUntil = 'domcontentloaded', extraWaitMs = 800 } = {}) {
    await assertUrlAllowed(url, { resolver: this.resolver });
    const browser = await this.ensureBrowser();

    return this.sem.run(async () => {
      const context = await browser.newContext({
        userAgent: this.userAgent,
        javaScriptEnabled: true,
        bypassCSP: false,
        viewport: { width: 1280, height: 900 },
      });
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(this.navigationTimeoutMs);

      await page.route('**/*', async (route) => {
        const req = route.request();
        const type = req.resourceType();
        const target = req.url();
        if (BLOCKED_RESOURCE_TYPES.has(type) || BLOCKED_URL_PATTERNS.some((re) => re.test(target))) {
          this.metrics.blockedRequests += 1;
          return route.abort();
        }
        /* Navigations (including redirects) are re-validated. */
        if (type === 'document') {
          try { await assertUrlAllowed(target, { resolver: this.resolver }); } catch {
            this.metrics.blockedRequests += 1;
            return route.abort();
          }
        }
        return route.continue();
      });

      const budget = new Promise((_, reject) => {
        const t = setTimeout(() => reject(Object.assign(new Error('page budget exceeded'), { errorClass: ERROR_CLASS.TIMEOUT })), this.pageBudgetMs);
        if (typeof t.unref === 'function') t.unref();
      });

      try {
        const work = (async () => {
          const response = await page.goto(url, { waitUntil });
          if (extraWaitMs) await page.waitForTimeout(extraWaitMs);
          const html = await page.content();
          return { html, status: response?.status() ?? null, url: page.url() };
        })();
        const result = await Promise.race([work, budget]);
        this.metrics.renders += 1;
        return result;
      } catch (e) {
        this.metrics.failures += 1;
        throw Object.assign(e, { errorClass: e.errorClass || ERROR_CLASS.TIMEOUT });
      } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
        this.touchIdle();
      }
    });
  }

  async close() {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    const b = this.browser;
    this.browser = null;
    if (b) await b.close().catch(() => {});
  }

  stats() {
    return {
      ...this.metrics,
      available: this.available,
      maxPages: this.maxPages,
      activePages: this.sem.active,
      browserUp: !!this.browser,
    };
  }
}

export default { BrowserPool, BLOCKED_RESOURCE_TYPES, BLOCKED_URL_PATTERNS };

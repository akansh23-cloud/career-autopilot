/* ============================================================
   Connector — NVD (NIST National Vulnerability Database CVEs;
   keyless, optional key raises rate limits)
   ============================================================ */
import { fetchJSON, sanitizeText } from '../util.js';
import { makeEvidence } from '../../collectiveIntelligence/normalizer.js';

const ENDPOINT = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

export async function fetchNVD(ctx = {}, opts = {}) {
  const query = String(ctx.securityQuery || ctx.query || '').trim();
  if (!query) return { ok: false, source: 'nvd', items: [], error: 'no query' };

  const limit = Math.min(opts.limit || 5, 10);
  /* NVD keyword search rejects very long phrases — keep it tight. */
  const keyword = query.split(/\s+/).slice(0, 5).join(' ').slice(0, 80);
  const url = `${ENDPOINT}?keywordSearch=${encodeURIComponent(keyword)}&resultsPerPage=${limit}`;
  const headers = opts.apiKey ? { apiKey: opts.apiKey } : {};
  const res = await fetchJSON(url, { headers, timeoutMs: opts.timeoutMs || 10000, maxBytes: opts.maxBytes });
  if (!res.ok) return { ok: false, source: 'nvd', items: [], error: `fetch failed (${res.status || res.error})` };

  let data;
  try { data = JSON.parse(res.text); } catch { return { ok: false, source: 'nvd', items: [], error: 'malformed response' }; }

  const items = (data?.vulnerabilities || []).slice(0, limit).map(({ cve }) => {
    const desc = (cve?.descriptions || []).find((d) => d.lang === 'en')?.value || '';
    const metric = cve?.metrics?.cvssMetricV31?.[0]?.cvssData || cve?.metrics?.cvssMetricV30?.[0]?.cvssData || {};
    return makeEvidence({
      source: 'nvd',
      sourceType: 'security_vulnerability',
      title: cve?.id || 'CVE record',
      summary: sanitizeText(desc, 500),
      url: cve?.id ? `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve.id)}` : 'https://nvd.nist.gov/',
      publishedDate: cve?.published || null,
      author: 'NIST NVD',
      rawScore: metric.baseScore || 0,
      tags: [metric.baseSeverity, metric.attackVector].filter(Boolean),
      evidenceType: 'security_vulnerability',
      metadata: { severity: metric.baseSeverity || 'UNKNOWN', cvss: metric.baseScore || 0, status: cve?.vulnStatus || '' },
      queryKeywords: ctx.queryKeywords || [],
    });
  });
  return { ok: true, source: 'nvd', items };
}

export default { fetchNVD };

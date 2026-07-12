/* ============================================================
   TIER-A MARKET HARDENING TESTS
   ------------------------------------------------------------
   1) csvSafe: the only sanctioned CSV builder — injection cases.
   2) /api/legal: public legal metadata endpoint (no auth), the
      grievance/contact source the ToS + Razorpay pages rely on.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvLine, buildCsv } from '../server/utils/csvSafe.js';
import { startServer, stopServer, makeClient } from './helpers.js';

test('csvCell neutralizes every spreadsheet formula trigger', () => {
  assert.equal(csvCell('=SUM(1+1)'), "'=SUM(1+1)");
  assert.equal(csvCell('+1234567890'), "'+1234567890");
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('@today'), "'@today");
  // Tab/CR smuggled triggers are stripped or neutralized, never executable.
  assert.ok(!csvCell('\t=cmd').startsWith('='));
  assert.ok(!csvCell('\r=cmd').includes('\r'));
});

test('csvCell applies RFC 4180 quoting only when needed', () => {
  assert.equal(csvCell('Apply Ready'), 'Apply Ready');            // plain: unquoted
  assert.equal(csvCell('Sharma, Aarav'), '"Sharma, Aarav"');      // comma: quoted
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');      // quotes doubled
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"');        // newline: quoted
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(0), '0');
});

test('buildCsv keeps column alignment for arrays and objects', () => {
  const header = ['name', 'score'];
  const csv = buildCsv(header, [['=evil', 97], { name: 'ok', score: 12 }]);
  const [h, r1, r2] = csv.split('\n');
  assert.equal(h, 'name,score');
  assert.equal(r1, "'=evil,97");
  assert.equal(r2, 'ok,12');
  assert.equal(csvLine(['a', 'b,c']), 'a,"b,c"');
});

test('GET /api/legal is public and exposes grievance + policy metadata', async () => {
  const { server, base } = await startServer();
  try {
    const client = makeClient(base);
    const res = await client.get('/api/legal');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.ok(typeof res.json.entityName === 'string' && res.json.entityName.length > 0);
    assert.ok(typeof res.json.grievanceEmail === 'string' && res.json.grievanceEmail.includes('@'));
    assert.ok(typeof res.json.supportEmail === 'string' && res.json.supportEmail.includes('@'));
    assert.ok(res.json.consentVersion, 'exposes the live consent version');
    assert.ok(res.json.policies && res.json.policies.terms && res.json.policies.privacy && res.json.policies.refunds,
      'lists effective dates for terms/privacy/refunds');
    // Never leaks configuration internals.
    assert.equal(res.json.smtp, undefined);
    assert.equal(res.json.adminEmails, undefined);
  } finally {
    await stopServer(server);
  }
});

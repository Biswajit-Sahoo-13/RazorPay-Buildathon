// E2E smoke test over the real HTTP server: boots `server/index.js` on a
// scratch port, drives the judge's demo path over the wire, asserts, exits.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3789;
const BASE = `http://localhost:${PORT}`;
const sessionId = 'smoke_' + Date.now();

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ` — ${detail}`}`);
}

async function api(pathname, body = null) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify({ sessionId, ...body }) : undefined,
  });
  return res.json();
}

async function waitForServer(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/config`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.env.SMOKE_VERBOSE && console.log('[server]', d.toString().trim()));
server.stderr.on('data', (d) => console.error('[server:err]', d.toString().trim()));

try {
  check('server boots', await waitForServer());

  const config = await api('/api/config');
  check('config: provider + limits', config.provider?.name === 'mock' && config.limits?.maxPerTransactionPaise === 500_000);

  const catalog = await api('/catalog.json');
  check(
    'agent-readable catalog: schema + how-to-buy + bounds in-band',
    catalog.schema_version === 'agent-catalog/1.0' && catalog.how_to_buy?.length === 7 && !!catalog.policies?.agent_bounds
  );

  const add = await api('/api/chat', { message: 'add 2 masala chai' });
  check('chat add → ok + cross-sell proposal', add.status === 'ok' && add.proposals?.length >= 1);
  check('totals: ₹498 + ₹49 shipping', add.state.totals.totalPaise === 54_700, `got ${add.state.totals.totalPaise}`);

  const clamp = await api('/api/chat', { message: 'apply SAVE30' });
  check('SAVE30 clamped to policy and explained', clamp.status === 'ok' && /clamp|cap/i.test(clamp.reply));

  const checkout = await api('/api/chat', { message: 'checkout' });
  check('checkout drafts order + token, no charge', checkout.status === 'ok' && !!checkout.data?.token && checkout.state.pendingOrder?.status === 'pending');
  const token = checkout.data.token;

  const agentPay = await api('/api/chat', { message: 'yes, pay now' });
  check('agent-confirm refused by structural gate (audited)', agentPay.status === 'gate_denied');

  const declined = await api('/api/confirm', { token, simulate: 'failure' });
  check('declined payment: failed honestly, order intact', declined.status === 'failed' && declined.state.pendingOrder?.attempts === 1 && /Nothing was charged/i.test(declined.message));

  // Same single-use token is still valid: the order stayed pending.
  const paid = await api('/api/confirm', { token });
  check('retry pays successfully', paid.status === 'ok' && paid.data?.order?.status === 'paid');

  const receipt = await api(`/api/receipt?orderId=${encodeURIComponent(paid.data.order.orderId)}`);
  check('agent-readable receipt', receipt.receipt_version === 'agent-receipt/1.0' && receipt.status === 'paid' && receipt.totalPaise === paid.data.order.totalPaise);

  const catalogAfter = await api('/catalog.json');
  const tea = catalogAfter.products.find((p) => p.sku === 'tea-masala');
  check('stock decremented after capture', tea.stock === 40, `got ${tea.stock}`);

  // Out-of-stock-at-checkout scenario
  await api('/api/chat', { message: 'add 1 hamper' });
  await api('/api/dev/set-stock', { sku: 'gift-hamper', qty: 0 });
  const oos = await api('/api/chat', { message: 'checkout' });
  check('OOS at checkout: blocked + graceful recovery message', oos.status === 'blocked' && /stock/i.test(oos.reply));
  await api('/api/dev/set-stock', { sku: 'gift-hamper', qty: 1 });

  const campaign = await api('/api/campaigns/run', {});
  check('campaign endpoint responds with bounded issuance', typeof campaign.issuedCount === 'number' && campaign.issuedCount >= 0);

  const audit = await api(`/api/audit?limit=200`);
  const actions = new Set(audit.events.map((e) => e.action));
  check(
    'audit trail captures the whole journey',
    ['cart.add', 'money.coupon_applied', 'money.order_drafted', 'money.payment_request', 'money.payment_failed', 'money.payment_captured'].every((a) => actions.has(a))
  );
  check('hash chain valid', audit.verify.valid === true);

  await api('/api/dev/tamper', {});
  const broken = await api('/api/audit/verify');
  check('tamper detection flips verify to invalid', broken.valid === false && broken.brokenAt > 0);
} catch (err) {
  check('smoke completed without exception', false, err.message);
} finally {
  server.kill();
}

const failedCount = results.filter((r) => !r.ok).length;
console.log(`\n${failedCount === 0 ? '✅ SMOKE PASS' : '❌ SMOKE FAIL'} — ${results.length - failedCount}/${results.length} checks passed\n`);
process.exit(failedCount === 0 ? 0 : 1);

// HTTP server — zero dependencies. Serves the web UI and the JSON API.
// Money-touching endpoints: /api/checkout (draft only) and /api/confirm
// (the ONLY place userGate=true is ever passed — the Pay button's call).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ROOT } from './config.js';
import { buildAgentCatalog, PRODUCTS } from './catalog.js';
import { createStore } from './store.js';
import { createAudit } from './audit.js';
import { createProvider } from './payments/provider.js';
import { createTools, publicOrder } from './agent/tools.js';
import { createLoop } from './agent/loop.js';
import { createLLM } from './agent/llm.js';
import { formatINR, nowISO } from './util.js';

const audit = createAudit(CONFIG.dataDir);
const store = createStore();
const provider = createProvider();
const llm = createLLM();
const tools = createTools({ store, audit, provider });
const loop = createLoop({ tools, store, llm });

const CLIENT_DIST = path.join(ROOT, 'client', 'dist');
const LEGACY_WEB = path.join(ROOT, 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json; charset=utf-8', '.map': 'application/json' };

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  const rel = path.normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');

  // Preferred: built React client (client/dist). Fallback: legacy vanilla web/.
  const base = fs.existsSync(path.join(CLIENT_DIST, 'index.html')) ? CLIENT_DIST : LEGACY_WEB;
  let full = path.join(base, rel);
  let ok = full.startsWith(base) && fs.existsSync(full) && fs.statSync(full).isFile();
  if (!ok && !rel.includes('api')) full = path.join(base, 'index.html'); // SPA fallback
  ok = full.startsWith(base) && fs.existsSync(full) && fs.statSync(full).isFile();
  if (!ok) return json(res, 404, { error: 'Not found' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
  res.end(fs.readFileSync(full));
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100_000) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sessionFrom(req, body) {
  const url = new URL(req.url, 'http://x');
  const sessionId = body.sessionId || url.searchParams.get('sessionId');
  return store.getSession(sessionId);
}

/** Cart-recovery campaign (Campaign Orchestrator, lite). */
function runCampaign() {
  const now = Date.now();
  const issued = [];
  for (const s of store.sessions.values()) {
    const idleFor = now - new Date(s.lastActivity).getTime();
    if (Object.keys(s.cart).length === 0) continue;
    if (idleFor < CONFIG.campaign.idleMs) continue;
    if (s.campaignIssues >= CONFIG.campaign.perSessionMaxIssues) continue;
    if (s.coupon) continue;
    s.coupon = { code: CONFIG.campaign.code };
    s.campaignIssues += 1;
    const totals = store.computeTotals(s);
    audit.append({
      sessionId: s.id,
      actor: 'system',
      tool: 'campaign.run',
      action: 'campaign.cart_recovery',
      explanation: `Cart idle ${Math.round(idleFor / 1000)}s — issued ${CONFIG.campaign.code} (−${formatINR(totals.discountPaise)}). New payable: ${formatINR(totals.totalPaise)}.`,
      reasoning: `Campaign ${CONFIG.campaign.code}: bounded (max ${CONFIG.campaign.perSessionMaxIssues} issue/session), skipped carts that already hold a coupon.`,
      payload: { code: CONFIG.campaign.code, idleForSeconds: Math.round(idleFor / 1000) },
      bounds: [{ name: 'per_session_issue_cap', pass: true, detail: `${s.campaignIssues}/${CONFIG.campaign.perSessionMaxIssues} used.` }],
    });
    issued.push({ sessionId: s.id, code: CONFIG.campaign.code, totalPaise: totals.totalPaise });
  }
  return { issuedCount: issued.length, issued, idleThresholdMs: CONFIG.campaign.idleMs };
}

function findOrder(orderId) {
  for (const s of store.sessions.values()) {
    const o = s.orders.find((x) => x.orderId === orderId) || (s.pendingOrder?.orderId === orderId ? s.pendingOrder : null);
    if (o) return o;
  }
  return null;
}

const routes = {
  'GET /api/config': (req, res) =>
    json(res, 200, {
      merchant: CONFIG.merchant,
      provider: { name: provider.name, label: provider.label, isSimulated: provider.isSimulated, llm: llm ? llm.name : 'rules-only' },
      limits: CONFIG.limits,
      shipping: CONFIG.shipping,
    }),

  'GET /api/catalog': (req, res) => json(res, 200, buildAgentCatalog()),
  'GET /catalog.json': (req, res) => json(res, 200, buildAgentCatalog()),

  'POST /api/chat': async (req, res) => {
    const body = await readBody(req);
    const session = sessionFrom(req, body);
    const result = await loop.handleChat(session, String(body.message || '').slice(0, 500));
    json(res, 200, result);
  },

  'POST /api/checkout': async (req, res) => {
    const body = await readBody(req);
    const session = sessionFrom(req, body);
    const result = tools.checkout(session);
    json(res, 200, { ...result, state: loop.publicState(session) });
  },

  'POST /api/confirm': async (req, res) => {
    const body = await readBody(req);
    const session = sessionFrom(req, body);
    // The ONLY userGate=true in the codebase — reached by the Pay button's click.
    const result = await tools.payConfirm(session, {
      userGate: true,
      token: body.token,
      simulate: body.simulate ?? null,
      card: body.card ?? null,
      paymentId: body.paymentId ?? null,
      signature: body.signature ?? null,
    });
    json(res, 200, { ...result, state: loop.publicState(session) });
  },

  'GET /api/state': (req, res) => {
    const session = sessionFrom(req, {});
    json(res, 200, { sessionId: session.id, state: loop.publicState(session) });
  },

  'GET /api/audit': (req, res) => {
    const url = new URL(req.url, 'http://x');
    const sessionId = url.searchParams.get('sessionId');
    const events = audit.list(sessionId);
    json(res, 200, { events: events.slice(-Number.parseInt(url.searchParams.get('limit') || '120', 10)).reverse(), verify: audit.verify() });
  },

  'GET /api/audit/verify': (req, res) => json(res, 200, audit.verify()),

  'GET /api/receipt': (req, res) => {
    const url = new URL(req.url, 'http://x');
    const orderId = url.searchParams.get('orderId') || url.pathname.split('/').pop();
    const order = findOrder(orderId);
    if (!order) return json(res, 404, { error: 'Order not found' });
    json(res, 200, {
      receipt_version: 'agent-receipt/1.0',
      orderId: order.orderId,
      providerOrderId: order.providerOrderId,
      paymentId: order.paymentId,
      status: order.status,
      paidAt: order.paidAt,
      attempts: order.attempts,
      merchant: CONFIG.merchant,
      currency: 'INR',
      items: order.items,
      subtotalPaise: order.subtotalPaise,
      discountPaise: order.discountPaise,
      couponCode: order.couponCode,
      shippingPaise: order.shippingPaise,
      totalPaise: order.totalPaise,
      auditTrail: { format: 'hash-chained JSONL', verify: '/api/audit/verify' },
    });
  },

  'POST /api/campaigns/run': (req, res) => json(res, 200, runCampaign()),

  // ── Demo/dev controls (clearly marked; power the judge-driven scenarios) ──
  'POST /api/dev/set-stock': async (req, res) => {
    const body = await readBody(req);
    const p = PRODUCTS.find((x) => x.sku === body.sku);
    if (!p) return json(res, 404, { error: 'Unknown sku' });
    const before = p.stock;
    p.stock = Math.max(0, Number.parseInt(body.qty, 10) || 0);
    audit.append({
      sessionId: '*',
      actor: 'system',
      tool: 'dev.set_stock',
      action: 'inventory.stock_changed',
      explanation: `Demo control: ${p.title} stock ${before} → ${p.stock}.`,
      reasoning: 'Simulates another buyer taking the last unit mid-session.',
      payload: { sku: p.sku, before, after: p.stock },
    });
    json(res, 200, { sku: p.sku, stock: p.stock });
  },

  'POST /api/dev/tamper': async (req, res) => {
    const id = audit.tamperLast();
    json(res, 200, { tampered: id ?? null, note: 'Ledger corrupted on purpose — verify will now fail.' });
  },

  'POST /api/dev/reset': async (req, res) => {
    const body = await readBody(req);
    const session = store.resetSession(body.sessionId);
    json(res, 200, { sessionId: session.id, state: loop.publicState(session) });
  },
};

const server = http.createServer(async (req, res) => {
  try {
    const key = `${req.method} ${new URL(req.url, 'http://x').pathname}`;
    const handler = routes[key] || (key.startsWith('GET /api/receipt/') ? routes['GET /api/receipt'] : null);
    if (handler) return await handler(req, res);
    if (req.method === 'GET' && !req.url.startsWith('/api')) return serveStatic(req, res);
    json(res, 404, { error: `No route: ${key}` });
  } catch (err) {
    json(res, err.message.includes('JSON') || err.message.includes('large') ? 400 : 500, { error: err.message });
  }
});

// Bind with fallback ports so the demo never dies to "EADDRINUSE".
let port = CONFIG.port;
let attempts = 0;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && attempts < 10) {
    attempts += 1;
    port += 1;
    server.listen(port);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});
server.listen(port, () => {
  console.log(`\n${CONFIG.merchant.name} agentic storefront`);
  console.log(`   UI:        http://localhost:${port}/`);
  console.log(`   Catalog:   http://localhost:${port}/catalog.json  (agent-readable)`);
  console.log(`   Provider:  ${provider.label}${llm ? `  ·  NLU: ${llm.name}` : '  ·  NLU: deterministic rules'}`);
  console.log(`   Audit:     hash-chained → ${path.join(CONFIG.dataDir, 'audit.jsonl')}`);
  console.log(`   Started:   ${nowISO()}\n`);
});

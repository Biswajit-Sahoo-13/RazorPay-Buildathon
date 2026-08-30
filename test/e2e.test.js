// Full-stack agent E2E (library level): NLU → tools → guardrails → payments
// → audit, over the real mock provider. Covers the two failure demos too.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createAudit } from '../server/audit.js';
import { createMockProvider } from '../server/payments/mock.js';
import { createTools } from '../server/agent/tools.js';
import { createLoop } from '../server/agent/loop.js';
import { PRODUCTS } from '../server/catalog.js';

function stack() {
  const audit = createAudit(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-')));
  const store = createStore();
  const provider = createMockProvider();
  const tools = createTools({ store, audit, provider });
  const loop = createLoop({ tools, store, llm: null });
  return { audit, store, provider, tools, loop };
}

test('happy path: add → clamp coupon → checkout → agent-confirm refused → user-confirm pays', async () => {
  const { audit, store, tools, loop } = stack();
  const session = store.getSession('e2e-1');
  const tea = PRODUCTS.find((p) => p.sku === 'tea-masala');
  const stockBefore = tea.stock;

  const add = await loop.handleChat(session, 'add 2 masala chai');
  assert.equal(add.status, 'ok');
  assert.ok(add.proposals.length >= 1, 'cross-sell proposal fires on add');

  const coupon = await loop.handleChat(session, 'apply SAVE30');
  assert.equal(coupon.status, 'ok');
  assert.match(coupon.reply, /clamp|cap/i);

  const checkout = await loop.handleChat(session, 'checkout');
  assert.equal(checkout.status, 'ok');
  assert.ok(checkout.state.pendingOrder, 'order drafted');
  const token = checkout.data.token;
  assert.ok(token);

  // The agent itself tries to pay — the structural gate must refuse.
  const agentPay = await loop.handleChat(session, 'yes, pay now');
  assert.equal(agentPay.status, 'gate_denied');
  assert.ok(checkout.state.pendingOrder);

  // The human declines at the gateway — failure path, nothing charged.
  const failed = await tools.payConfirm(session, { userGate: true, token, simulate: 'failure' });
  assert.equal(failed.status, 'failed');
  assert.equal(session.pendingOrder.attempts, 1);
  assert.match(failed.message, /Nothing was charged/);

  // Retry, same order and fresh token still valid (order stays pending).
  const retry = await tools.payConfirm(session, { userGate: true, token: session.pendingOrder.confirmToken });
  assert.equal(retry.status, 'ok');
  assert.equal(session.pendingOrder, null, 'cart + pending order cleared');
  assert.equal(session.sessionSpendPaise, session.orders[0].totalPaise);
  assert.equal(tea.stock, stockBefore - 2, 'stock decremented on capture');

  const paidEvent = audit.list('e2e-1').find((e) => e.action === 'money.payment_captured');
  assert.ok(paidEvent, 'capture audited');
  assert.ok(audit.list('e2e-1').find((e) => e.status === 'gate_denied'), 'agent refusal audited');
  assert.ok(audit.list('e2e-1').find((e) => e.action === 'money.payment_failed'), 'decline audited');
  assert.equal(audit.verify().valid, true);
});

test('out-of-stock mid-session: checkout blocked, explained, nothing drafted', async () => {
  const { store, tools, loop } = stack();
  const session = store.getSession('e2e-2');
  const hamper = PRODUCTS.find((p) => p.sku === 'gift-hamper');
  const stockBefore = hamper.stock;

  await loop.handleChat(session, 'add 1 hamper');
  hamper.stock = 0; // "another buyer" took it
  const checkout = await loop.handleChat(session, 'checkout');
  assert.equal(checkout.status, 'blocked');
  assert.match(checkout.reply, /stock/i);
  assert.equal(session.pendingOrder, null);
  hamper.stock = stockBefore;
});

test('quantity bound blocks oversized adds through chat', async () => {
  const { store, loop } = stack();
  const session = store.getSession('e2e-3');
  const r = await loop.handleChat(session, 'add 6 masala chai');
  assert.equal(r.status, 'blocked');
  assert.match(r.reply, /at most 5 units/i);
});

test('recommendations are bounded to two per turn', async () => {
  const { store, loop } = stack();
  const session = store.getSession('e2e-4');
  const r = await loop.handleChat(session, 'what pairs with the coffee?');
  assert.ok(r.proposals.length <= 2);
});

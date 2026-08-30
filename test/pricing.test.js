// Pricing tests — paise-exact money math and policy clamps.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.js';

const store = createStore();

test('subtotal, free-shipping threshold and total math', () => {
  const s = store.getSession('p1');
  store.setQty(s, 'tea-masala', 2); // ₹249 × 2 = ₹498 → free shipping above ₹499? 498 < 499 → ₹49
  const t = store.computeTotals(s);
  assert.equal(t.subtotalPaise, 49_800);
  assert.equal(t.shippingPaise, 4_900);
  assert.equal(t.totalPaise, 54_700);

  store.setQty(s, 'tea-masala', 3); // ₹747 → free shipping
  const t2 = store.computeTotals(s);
  assert.equal(t2.shippingPaise, 0);
  assert.equal(t2.totalPaise, 74_700);
});

test('WELCOME10 applies 10% across the cart', () => {
  const s = store.getSession('p2');
  store.setQty(s, 'tea-masala', 2); // ₹498
  s.coupon = { code: 'WELCOME10' };
  const t = store.computeTotals(s);
  assert.equal(t.discountPaise, 4_980);
  assert.equal(t.totalPaise, 49_800 - 4_980 + 4_900);
});

test('CHAI20 applies to tea items only', () => {
  const s = store.getSession('p3');
  store.setQty(s, 'tea-masala', 2); // ₹498 tea
  store.setQty(s, 'coffee-filter', 1); // ₹399 coffee (not eligible)
  s.coupon = { code: 'CHAI20' };
  const t = store.computeTotals(s);
  assert.equal(t.discountPaise, Math.floor((49_800 * 20) / 100)); // ₹99.60 → 9960 paise, tea-only base
});

test('SAVE30 is clamped to the 20% policy cap and explained', () => {
  const s = store.getSession('p4');
  store.setQty(s, 'tea-masala', 4); // ₹996
  s.coupon = { code: 'SAVE30' };
  const t = store.computeTotals(s);
  assert.equal(t.discountPaise, Math.floor((99_600 * 20) / 100)); // 20%, not 30%
  const clamp = t.couponClamps.find((c) => c.type === 'policy_percent_cap');
  assert.ok(clamp, 'percent clamp must be recorded for the audit trail');
  assert.equal(clamp.from, 30);
  assert.equal(clamp.to, 20);
});

test('coupon amount cap: never more than policy max', () => {
  const s = store.getSession('p5');
  store.setQty(s, 'gift-hamper', 1); // ₹1,499
  s.coupon = { code: 'SAVE30' }; // would be 20% = ₹299.80 → ₹299; under ₹1,000 cap, but percent clamp applies
  const t = store.computeTotals(s);
  assert.ok(t.discountPaise <= 100_000);
});

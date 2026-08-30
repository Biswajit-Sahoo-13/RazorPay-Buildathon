// NLU tests — the deterministic parser must route these exactly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, matchProduct, searchProducts } from '../server/agent/nlu.js';

test('add intent with quantity', () => {
  const r = parse('add 2 masala chai');
  assert.equal(r.intent, 'add');
  assert.equal(r.slots.sku, 'tea-masala');
  assert.equal(r.slots.qty, 2);
});

test('add intent with number word', () => {
  const r = parse('I will take two butter cookies');
  assert.equal(r.intent, 'add');
  assert.equal(r.slots.sku, 'cookie-butter');
  assert.equal(r.slots.qty, 2);
});

test('find intent with budget', () => {
  const r = parse('gift under 500');
  assert.equal(r.intent, 'find');
  assert.equal(r.slots.budgetPaise, 50_000);
});

test('coupon intent with code', () => {
  const r = parse('apply SAVE30');
  assert.equal(r.intent, 'coupon');
  assert.equal(r.slots.code, 'SAVE30');
});

test('checkout intent', () => {
  assert.equal(parse('checkout').intent, 'checkout');
  assert.equal(parse('place the order').intent, 'checkout');
});

test('confirm only when a pending order exists', () => {
  assert.equal(parse('yes, pay now', { hasPendingOrder: true }).intent, 'confirm');
  assert.notEqual(parse('yes, pay now', { hasPendingOrder: false }).intent, 'confirm');
});

test('recommend intent', () => {
  const r = parse('what pairs with the coffee?');
  assert.equal(r.intent, 'recommend');
  assert.equal(r.slots.sku, 'coffee-filter');
});

test('remove intent', () => {
  const r = parse('remove the hamper');
  assert.equal(r.intent, 'remove');
  assert.equal(r.slots.sku, 'gift-hamper');
});

test('product matching handles aliases and fuzzy text', () => {
  assert.equal(matchProduct('kulhad cups')?.product.sku, 'mug-kulhad');
  assert.equal(matchProduct('masala chai')?.product.sku, 'tea-masala');
  assert.equal(matchProduct('xyzzy gibberish'), null);
});

test('search ranks tea results for tea query', () => {
  const results = searchProducts('strong chai');
  assert.ok(results.some((p) => p.sku === 'tea-masala'));
});

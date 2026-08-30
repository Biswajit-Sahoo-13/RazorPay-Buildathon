// The bounds engine — "every money action bounded" lives here. Both the
// agent tools and the direct user-UI endpoints call these exact functions,
// so the agent cannot do anything a human couldn't, and vice versa.
// Each check returns a human-readable record that goes straight into the
// audit trail.

import { CONFIG } from './config.js';
import { formatINR } from './util.js';

const check = (name, pass, detail) => ({ name, pass, detail });

export function checkAddToCart(store, session, sku, qty) {
  const p = store.product(sku);
  if (!p) return { pass: false, checks: [check('sku_exists', false, `Unknown product: ${sku}`)] };
  const checks = [
    check('qty_positive', qty >= 1, `Requested quantity ${qty} must be ≥ 1.`),
    check(
      'stock_available',
      store.qtyInCart(session, sku) + qty <= p.stock,
      `${p.title}: cart ${store.qtyInCart(session, sku)} + ${qty} vs stock ${p.stock}.`
    ),
    check(
      'max_qty_per_sku',
      store.qtyInCart(session, sku) + qty <= CONFIG.limits.maxQtyPerSku,
      `Policy allows at most ${CONFIG.limits.maxQtyPerSku} units of one SKU per cart.`
    ),
    check(
      'max_cart_items',
      Object.values(session.cart).reduce((s, q) => s + q, 0) + qty <= CONFIG.limits.maxCartItems,
      `Policy allows at most ${CONFIG.limits.maxCartItems} items per cart.`
    ),
  ];
  return { pass: checks.every((c) => c.pass), checks };
}

export function checkCoupon(offer, store, session) {
  if (!offer) return { pass: false, checks: [check('coupon_exists', false, 'Unknown coupon code.')] };
  const totals = store.computeTotals(session);
  const checks = [
    check('coupon_exists', true, `${offer.code}: ${offer.description}`),
    check(
      'min_cart_met',
      !offer.minCartPaise || totals.subtotalPaise >= offer.minCartPaise,
      offer.minCartPaise
        ? `${offer.code} needs a cart of at least ${formatINR(offer.minCartPaise)} (cart: ${formatINR(totals.subtotalPaise)}).`
        : 'No minimum cart.'
    ),
  ];
  if (offer.appliesToCategory) {
    const hasCat = totals.items.some((i) => store.product(i.sku).category === offer.appliesToCategory);
    checks.push(
      check(
        'category_eligible',
        hasCat,
        `${offer.code} applies to "${offer.appliesToCategory}" items only; cart ${hasCat ? 'contains' : 'does not contain'} such items.`
      )
    );
  }
  return { pass: checks.every((c) => c.pass), checks };
}

/**
 * The money gate. `checkout` drafts an order without charging; this is the
 * last server-side look before any payment can be requested.
 */
export function checkCheckout(store, session, totals) {
  const checks = [
    check('cart_not_empty', totals.items.length > 0, `${totals.itemCount} item(s) in cart.`),
  ];
  for (const item of totals.items) {
    const p = store.product(item.sku);
    checks.push(
      check(
        'stock_recheck_at_checkout',
        item.qty <= p.stock,
        `${p.title}: ${item.qty} in cart vs ${p.stock} in stock${item.qty > p.stock ? ' — another buyer got there first.' : '.'}`
      )
    );
  }
  checks.push(
    check(
      'max_per_transaction',
      totals.totalPaise <= CONFIG.limits.maxPerTransactionPaise,
      `Order total ${formatINR(totals.totalPaise)} vs cap ${formatINR(CONFIG.limits.maxPerTransactionPaise)}.`
    ),
    check(
      'max_session_spend',
      session.sessionSpendPaise + totals.totalPaise <= CONFIG.limits.maxSessionSpendPaise,
      `Paid this session ${formatINR(session.sessionSpendPaise)} + this order ${formatINR(totals.totalPaise)} vs cap ${formatINR(CONFIG.limits.maxSessionSpendPaise)}.`
    )
  );
  return { pass: checks.every((c) => c.pass), checks };
}

/**
 * The confirmation gate. A payment attempt is valid only when
 *  - a pending order exists,
 *  - the single-use token issued at checkout is presented, and
 *  - the call originated from the user's own click (userGate=true).
 * The agent loop can never set userGate=true — this is what makes the gate
 * structural, not a prompt-level politeness.
 */
export function checkPaymentGate(session, token, userGate) {
  const checks = [
    check('pending_order_exists', !!session.pendingOrder, session.pendingOrder ? `Order ${session.pendingOrder.orderId} is pending.` : 'No order draft to pay for.'),
    check(
      'single_use_token_valid',
      !!session.pendingOrder?.confirmToken && token === session.pendingOrder.confirmToken,
      'Payment must present the one-time token issued at checkout.'
    ),
    check('user_confirmation_present', userGate === true, 'Money moves only on an explicit click by the human — the agent cannot confirm on their behalf.'),
  ];
  return { pass: checks.every((c) => c.pass), checks };
}

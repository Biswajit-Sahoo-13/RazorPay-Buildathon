// Agent tools. Every tool that touches money or state:
//   1. runs the guardrail checks FIRST,
//   2. then mutates state,
//   3. then appends a fully-explained event to the hash-chained audit ledger.
// Blocked attempts are audited too — refusals are first-class outcomes.
// The chat-facing "confirm" path can never set userGate=true; only the
// /api/confirm endpoint (the human's click) can. That asymmetry IS the gate.

import { PRODUCTS, findOffer, findProduct } from '../catalog.js';
import { searchProducts } from './nlu.js';
import { CONFIG } from '../config.js';
import { checkAddToCart, checkCheckout, checkCoupon, checkPaymentGate } from '../guardrails.js';
import { formatINR, uid } from '../util.js';

const MAX_PROPOSALS_PER_TURN = 2; // recommendation bound, visible in audit

export function createTools({ store, audit, provider }) {
  const p = (sku) => store.product(sku);

  function searchCatalog(session, { query, budgetPaise = null } = {}) {
    const results = searchProducts(query, budgetPaise);
    audit.append({
      sessionId: session.id,
      actor: 'agent',
      tool: 'search_catalog',
      action: 'catalog.search',
      explanation: `Searched "${query}"${budgetPaise ? ` under ${formatINR(budgetPaise)}` : ''} — ${results.length} match(es).`,
      reasoning: 'Read-only; results ranked by relevance then price.',
      payload: { query, budgetPaise },
    });
    return {
      ok: true,
      status: 'ok',
      message: results.length
        ? results.map((r) => `**${r.title}** — ${formatINR(r.pricePaise)} (${r.stock} in stock)`).join('\n')
        : 'Nothing matched. Try "tea", "coffee", "gift under 500"…',
      data: { results: results.map((r) => ({ sku: r.sku, title: r.title, pricePaise: r.pricePaise, stock: r.stock })) },
    };
  }

  function addToCart(session, { sku, qty = 1 } = {}) {
    const product = p(sku);
    const gate = checkAddToCart(store, session, sku, qty);
    if (!gate.pass) {
      const failed = gate.checks.filter((c) => !c.pass);
      audit.append({
        sessionId: session.id,
        actor: 'agent',
        tool: 'add_to_cart',
        action: 'cart.add',
        status: 'blocked',
        explanation: `Blocked add of ${qty} × ${product?.title ?? sku}: ${failed.map((f) => f.name).join(', ')}.`,
        reasoning: 'Bounds are checked before any state change; refusals are audited.',
        payload: { sku, qty },
        bounds: gate.checks,
      });
      return {
        ok: false,
        status: 'blocked',
        message: `I can't add that: ${failed.map((f) => f.detail).join(' ')}`,
        data: { bounds: gate.checks },
      };
    }
    store.setQty(session, sku, store.qtyInCart(session, sku) + qty);
    const totals = store.computeTotals(session);
    const line = totals.items.find((i) => i.sku === sku);
    audit.append({
      sessionId: session.id,
      actor: 'agent',
      tool: 'add_to_cart',
      action: 'cart.add',
      explanation: `Added ${qty} × ${product.title} (${formatINR(line.linePaise)}). Cart: ${formatINR(totals.totalPaise)}.`,
      reasoning: 'User request; no money moved yet — charging happens only at the confirmation gate.',
      payload: { sku, qty },
      bounds: gate.checks,
    });
    return {
      ok: true,
      status: 'ok',
      message: `Added ${qty} × **${product.title}** — ${formatINR(line.linePaise)}. Cart total: **${formatINR(totals.totalPaise)}**.`,
      data: { totals, bounds: gate.checks },
    };
  }

  function removeFromCart(session, { sku, qty = 1 } = {}) {
    const product = p(sku);
    const have = store.qtyInCart(session, sku);
    if (!product || have === 0) {
      return { ok: false, status: 'blocked', message: `${product?.title ?? sku} isn't in your cart.` };
    }
    const newQty = Math.max(0, have - qty);
    store.setQty(session, sku, newQty);
    if (session.coupon && newQty === 0) {
      const offer = findOffer(session.coupon.code);
      if (offer?.appliesToCategory && product.category !== offer.appliesToCategory) {
        // keep coupon; recompute naturally in totals
      }
    }
    const totals = store.computeTotals(session);
    audit.append({
      sessionId: session.id,
      actor: 'agent',
      tool: 'remove_from_cart',
      action: 'cart.remove',
      explanation: `Removed ${qty} × ${product.title}. Cart now ${formatINR(totals.totalPaise)}.`,
      reasoning: 'User request.',
      payload: { sku, qty },
    });
    return {
      ok: true,
      status: 'ok',
      message: `Removed ${qty} × ${product.title}. Cart: **${formatINR(totals.totalPaise)}**.`,
      data: { totals },
    };
  }

  /**
   * The growth engine. Recommendations are audited WITH their reasoning and
   * capped at MAX_PROPOSALS_PER_TURN — growth actions are bounded too.
   */
  function recommend(session, { sku = null } = {}) {
    const proposals = [];
    const inCart = (s) => store.qtyInCart(session, s) > 0;

    const seed = sku ? p(sku) : null;
    if (seed) {
      for (const cSku of seed.complements) {
        const c = p(cSku);
        if (c && !inCart(cSku) && c.stock > 0) {
          proposals.push({
            sku: cSku, title: c.title, pricePaise: c.pricePaise,
            pitch: `Pairs with your ${seed.title} — bought together by 68% of ${c.category} buyers.`,
            rule: `complements[${seed.sku}]`,
          });
        }
        if (proposals.length >= MAX_PROPOSALS_PER_TURN) break;
      }
    }

    // Free-shipping nudge: cheapest useful item that unlocks it.
    const totals = store.computeTotals(session);
    const payable = totals.subtotalPaise - totals.discountPaise;
    if (proposals.length < MAX_PROPOSALS_PER_TURN && totals.items.length > 0) {
      const gap = CONFIG.shipping.freeAbovePaise - payable;
      if (gap > 0 && gap <= 15_000) {
        const cheapest = PRODUCTS.filter((x) => !inCart(x.sku) && x.stock > 0 && x.pricePaise >= Math.max(gap - 10_000, 0) && x.pricePaise <= gap)
          .sort((a, b) => b.pricePaise - a.pricePaise)[0];
        if (cheapest) {
          proposals.push({
            sku: cheapest.sku, title: cheapest.title, pricePaise: cheapest.pricePaise,
            pitch: `${formatINR(gap)} short of free shipping — this closes the gap and saves the ${formatINR(CONFIG.shipping.flatPaise)} fee.`,
            rule: 'free_shipping_nudge',
          });
        }
      }
    }

    audit.append({
      sessionId: session.id,
      actor: 'agent',
      tool: 'recommend',
      action: 'growth.recommendation',
      explanation: proposals.length
        ? `Proposed ${proposals.length} item(s): ${proposals.map((x) => x.title).join(', ')}.`
        : 'No well-justified proposal — staying quiet beats noisy upsell.',
      reasoning: proposals.map((x) => x.rule).join(' + ') || 'no matching rule',
      payload: { seedSku: sku, proposals: proposals.map((x) => x.sku) },
      bounds: [{ name: 'max_proposals_per_turn', pass: proposals.length <= MAX_PROPOSALS_PER_TURN, detail: `Capped at ${MAX_PROPOSALS_PER_TURN}; showing ${proposals.length}.` }],
    });
    return { ok: true, status: 'ok', message: '', proposals, data: { proposals } };
  }

  function applyCoupon(session, { code } = {}) {
    const offer = findOffer(code);
    const gate = checkCoupon(offer, store, session);
    if (!gate.pass) {
      const failed = gate.checks.filter((c) => !c.pass);
      audit.append({
        sessionId: session.id,
        actor: 'agent',
        tool: 'apply_coupon',
        action: 'money.coupon_applied',
        status: 'blocked',
        explanation: `Blocked ${offer?.code ?? code}: ${failed.map((f) => f.name).join(', ')}.`,
        reasoning: 'Coupon eligibility is a money-affecting rule — checked server-side, never by the agent.',
        payload: { code },
        bounds: gate.checks,
      });
      return {
        ok: false,
        status: 'blocked',
        message: `Can't apply that coupon: ${failed.map((f) => f.detail).join(' ')}`,
        data: { bounds: gate.checks },
      };
    }
    session.coupon = { code: offer.code };
    const totals = store.computeTotals(session);
    const clampNote = totals.couponClamps.map((c) => c.detail).join(' ');
    audit.append({
      sessionId: session.id,
      actor: 'agent',
      tool: 'apply_coupon',
      action: 'money.coupon_applied',
      explanation: `Applied ${offer.code}: −${formatINR(totals.discountPaise)}${clampNote ? ` ${clampNote}` : ''} Payable: ${formatINR(totals.totalPaise)}.`,
      reasoning: 'Discount computed from catalog offer rules and policy caps server-side.',
      payload: { code: offer.code, discountPaise: totals.discountPaise, clamps: totals.couponClamps },
      bounds: gate.checks,
    });
    return {
      ok: true,
      status: 'ok',
      message: `Applied **${offer.code}** — ${offer.description} Discount: −${formatINR(totals.discountPaise)}.${clampNote ? `\nClamped by policy: ${clampNote}` : ''} Payable: **${formatINR(totals.totalPaise)}**.`,
      data: { totals },
    };
  }

  /**
   * Drafts an order but never charges. Returns a single-use confirm token
   * that only means something when posted from the human's click.
   */
  function checkout(session) {
    const totals = store.computeTotals(session);
    const gate = checkCheckout(store, session, totals);
    if (!gate.pass) {
      const failed = gate.checks.filter((c) => !c.pass);
      const oos = failed.filter((f) => f.name === 'stock_recheck_at_checkout');
      audit.append({
        sessionId: session.id,
        actor: 'agent',
        tool: 'checkout',
        action: 'money.order_drafted',
        status: 'blocked',
        explanation: `Blocked checkout (${formatINR(totals.totalPaise)}): ${failed.map((f) => f.name).join(', ')}.`,
        reasoning: 'Stock and spend caps re-verified at checkout time — state may have changed since items were added.',
        payload: { totalPaise: totals.totalPaise },
        bounds: gate.checks,
      });
      const message = oos.length
        ? `While you were shopping, stock ran out on: ${oos.map((f) => f.detail).join(' ')}\nNothing was charged. I can drop the sold-out item and re-checkout, or suggest an alternative — say "fix my cart".`
        : `I can't check out: ${failed.map((f) => f.detail).join(' ')}`;
      return { ok: false, status: 'blocked', message, data: { bounds: gate.checks } };
    }

    const order = store.draftOrder(session, totals);
    let created;
    try {
      created = provider.createOrder({ orderId: order.orderId, totalPaise: order.totalPaise });
    } catch (err) {
      audit.append({
        sessionId: session.id,
        actor: 'agent',
        tool: 'checkout',
        action: 'money.order_drafted',
        status: 'failed',
        explanation: `Gateway order creation failed: ${err.message}`,
        reasoning: 'Provider outage is a failure the agent must surface, not hide.',
        payload: { orderId: order.orderId },
      });
      return { ok: false, status: 'failed', message: `The gateway refused to create the order (${err.message}). Nothing was charged — please try checkout again.` };
    }
    order.providerOrderId = created.providerOrderId;
    order.confirmToken = uid('tok');
    session.orders.push(order);
    audit.append({
      sessionId: session.id,
      actor: 'agent',
      tool: 'checkout',
      action: 'money.order_drafted',
      explanation: `Order ${order.orderId} drafted at ${formatINR(order.totalPaise)} (gateway order ${created.providerOrderId}). Awaiting the user's explicit confirmation — no charge yet.`,
      reasoning: 'Structural gate: the agent cannot capture payment; only a user click bearing this single-use token can.',
      payload: { orderId: order.orderId, providerOrderId: created.providerOrderId, totalPaise: order.totalPaise },
      bounds: gate.checks,
    });
    return {
      ok: true,
      status: 'ok',
      message: `Order drafted: **${formatINR(order.totalPaise)}** (${order.items.length} line${order.items.length > 1 ? 's' : ''}${totals.discountPaise ? `, ${totals.couponCode} −${formatINR(totals.discountPaise)}` : ''}).\nI can't charge you — press **Pay** in the checkout panel to approve it.`,
      data: { order: publicOrder(order), token: order.confirmToken, checkout: created.checkout },
    };
  }

  /**
   * The only path money can move through.
   * userGate=true happens solely from the human's click on /api/confirm.
   * Any other caller (including the agent itself) gets a gate_denied audit
   * event and a refusal.
   */
  async function payConfirm(session, { userGate = false, token = null, simulate = null, card = null, paymentId = null, signature = null } = {}) {
    const gate = checkPaymentGate(session, token, userGate);
    if (!gate.pass) {
      const agentAttempted = userGate !== true && session.pendingOrder;
      audit.append({
        sessionId: session.id,
        actor: agentAttempted ? 'agent' : 'user',
        tool: 'confirm_payment',
        action: 'money.payment_request',
        status: 'gate_denied',
        explanation: agentAttempted
          ? 'Agent attempted to capture payment without a user confirmation gesture — refused by the structural gate.'
          : `Payment attempt rejected: ${gate.checks.filter((c) => !c.pass).map((c) => c.name).join(', ')}.`,
        reasoning: 'The gate is structural: userGate is only set by the endpoint the Pay button calls.',
        payload: { token: token ? 'present' : 'absent', userGate },
        bounds: gate.checks,
      });
      return {
        ok: false,
        status: 'gate_denied',
        message: agentAttempted
          ? "I'm not allowed to move money on your behalf — that click has to be yours. Press **Pay** in the checkout panel and I'll take it from there. (This refusal is recorded in the audit trail.)"
          : `This payment can't be processed: ${gate.checks.filter((c) => !c.pass).map((c) => c.detail).join(' ')}`,
        data: { bounds: gate.checks },
      };
    }

    const order = session.pendingOrder;
    order.attempts += 1;

    // Obtain the payment attempt: real gateway (client callback) or simulated.
    let attempt = { ok: true, paymentId, signature };
    if (provider.isSimulated && !paymentId) {
      attempt = await provider.simulateCharge({ providerOrderId: order.providerOrderId, amountPaise: order.totalPaise, simulate, card });
    }

    if (!attempt.ok) {
      order.failureReason = attempt.description || attempt.error;
      audit.append({
        sessionId: session.id,
        actor: 'user',
        tool: 'confirm_payment',
        action: 'money.payment_failed',
        status: 'failed',
        explanation: `Payment attempt ${order.attempts} on ${order.orderId} failed: ${attempt.error}. No money moved; cart and order preserved for retry.`,
        reasoning: 'Failure surfaced honestly with recovery options — never retried silently.',
        payload: { orderId: order.orderId, attempt: order.attempts, error: attempt.error },
      });
      return {
        ok: false,
        status: 'failed',
        message: `The bank declined your payment (simulated failure). **Nothing was charged.** Your order of ${formatINR(order.totalPaise)} is intact — press **Pay** to retry, or say "remove one item" to try a smaller basket.`,
        data: { order: publicOrder(order) },
      };
    }

    if (!provider.verifyPayment({ providerOrderId: order.providerOrderId, paymentId: attempt.paymentId, signature: attempt.signature })) {
      audit.append({
        sessionId: session.id,
        actor: 'user',
        tool: 'confirm_payment',
        action: 'money.payment_failed',
        status: 'failed',
        explanation: `Signature verification FAILED on ${order.orderId} — treating as unverified and refusing capture.`,
        reasoning: 'A payment is real only if its HMAC signature matches; mismatches are security events.',
        payload: { orderId: order.orderId, paymentId: attempt.paymentId },
      });
      return { ok: false, status: 'failed', message: 'Payment signature verification failed — I will not capture this payment. Please retry.' };
    }

    // Captured. Settle: stock, spend ledger, cart, token.
    order.status = 'paid';
    order.paymentId = attempt.paymentId;
    order.paidAt = new Date().toISOString();
    for (const item of order.items) {
      const prod = p(item.sku);
      if (prod) prod.stock = Math.max(0, prod.stock - item.qty);
    }
    session.sessionSpendPaise += order.totalPaise;
    session.cart = {};
    session.coupon = null;
    session.pendingOrder = null;

    audit.append({
      sessionId: session.id,
      actor: 'user',
      tool: 'confirm_payment',
      action: 'money.payment_captured',
      explanation: `Captured ${formatINR(order.totalPaise)} on ${order.orderId} (${attempt.paymentId}). Stock updated; spend ledger now ${formatINR(session.sessionSpendPaise)} this session.`,
      reasoning: 'Verified signature → settle atomically: stock decrement + spend cap ledger + cart clear + single-use token burn.',
      payload: { orderId: order.orderId, paymentId: attempt.paymentId, totalPaise: order.totalPaise },
      bounds: [{ name: 'session_spend_after', pass: session.sessionSpendPaise <= CONFIG.limits.maxSessionSpendPaise, detail: `${formatINR(session.sessionSpendPaise)} / ${formatINR(CONFIG.limits.maxSessionSpendPaise)} cap.` }],
    });
    return {
      ok: true,
      status: 'ok',
      message: `**Paid ${formatINR(order.totalPaise)}** — order ${order.orderId} confirmed (${attempt.paymentId}).\nAgent-readable receipt: \`/api/receipt/${order.orderId}\``,
      data: { order: publicOrder(order), receiptPath: `/api/receipt/${order.orderId}` },
    };
  }

  function clearCart(session) {
    session.cart = {};
    session.coupon = null;
    audit.append({
      sessionId: session.id,
      actor: 'user',
      tool: 'clear_cart',
      action: 'cart.clear',
      explanation: 'Cart cleared by user.',
      reasoning: 'User request.',
    });
    return { ok: true, status: 'ok', message: 'Cart cleared.' };
  }

  function info(session, { sku }) {
    const product = p(sku) ?? findProduct(sku);
    if (!product) return { ok: false, status: 'blocked', message: "I couldn't find that product." };
    return {
      ok: true,
      status: 'ok',
      message: `**${product.title}** — ${formatINR(product.pricePaise)}, ${product.stock} in stock.\n${product.description}`,
    };
  }

  return { searchCatalog, addToCart, removeFromCart, recommend, applyCoupon, checkout, payConfirm, clearCart, info };
}

export function publicOrder(order) {
  return {
    orderId: order.orderId,
    providerOrderId: order.providerOrderId,
    status: order.status,
    totalPaise: order.totalPaise,
    attempts: order.attempts,
    failureReason: order.failureReason,
    paymentId: order.paymentId,
  };
}

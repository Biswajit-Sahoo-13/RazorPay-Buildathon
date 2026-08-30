// Sessions, carts and pricing. The store is deliberately dumb: it mutates
// state and computes money math in integer paise; enforcement lives in
// guardrails.js so that both the agent path and the direct user-UI path go
// through the exact same checks.

import { CONFIG } from './config.js';
import { PRODUCTS, findOffer } from './catalog.js';
import { uid, nowISO } from './util.js';

export function createStore() {
  const sessions = new Map();

  function getSession(sessionId) {
    let s = sessions.get(sessionId);
    if (!s) {
      s = {
        id: sessionId || uid('sess'),
        createdAt: nowISO(),
        lastActivity: nowISO(),
        cart: {}, // sku -> qty
        coupon: null, // { code, discountPaise, explanation, clamps }
        pendingOrder: null,
        orders: [],
        sessionSpendPaise: 0,
        campaignIssues: 0,
      };
      sessions.set(s.id, s);
    }
    s.lastActivity = nowISO();
    return s;
  }

  function resetSession(sessionId) {
    sessions.delete(sessionId);
    return getSession(sessionId);
  }

  const product = (sku) => PRODUCTS.find((p) => p.sku === sku);

  function qtyInCart(session, sku) {
    return session.cart[sku] || 0;
  }

  function setQty(session, sku, qty) {
    if (qty <= 0) delete session.cart[sku];
    else session.cart[sku] = qty;
  }

  /** Coupon discount with every clamp recorded for the audit trail. */
  function computeCouponDiscount(session) {
    if (!session.coupon?.code) return { discountPaise: 0, clamps: [] };
    const offer = findOffer(session.coupon.code);
    if (!offer) return { discountPaise: 0, clamps: [] };

    const items = Object.entries(session.cart);
    const eligiblePaise = offer.appliesToCategory
      ? items
          .filter(([sku]) => product(sku)?.category === offer.appliesToCategory)
          .reduce((s, [sku, qty]) => s + product(sku).pricePaise * qty, 0)
      : items.reduce((s, [sku, qty]) => s + product(sku).pricePaise * qty, 0);

    const clamps = [];
    let pct = offer.value;
    if (offer.type === 'percent' && pct > CONFIG.limits.couponMaxPercent) {
      clamps.push({
        type: 'policy_percent_cap',
        from: pct,
        to: CONFIG.limits.couponMaxPercent,
        detail: `${offer.code} advertises ${pct}% but policy caps coupons at ${CONFIG.limits.couponMaxPercent}%.`,
      });
      pct = CONFIG.limits.couponMaxPercent;
    }

    let discount =
      offer.type === 'percent'
        ? Math.floor((eligiblePaise * pct) / 100)
        : Math.min(offer.value, eligiblePaise);

    if (offer.maxDiscountPaise && discount > offer.maxDiscountPaise) {
      clamps.push({
        type: 'offer_max_discount',
        from: discount,
        to: offer.maxDiscountPaise,
        detail: `Offer's own ceiling: max ${offer.maxDiscountPaise / 100} off.`,
      });
      discount = offer.maxDiscountPaise;
    }
    if (discount > CONFIG.limits.couponMaxPaise) {
      clamps.push({
        type: 'policy_amount_cap',
        from: discount,
        to: CONFIG.limits.couponMaxPaise,
        detail: `Policy caps any coupon at ${CONFIG.limits.couponMaxPaise / 100} off.`,
      });
      discount = CONFIG.limits.couponMaxPaise;
    }
    return { discountPaise: discount, clamps, eligiblePaise };
  }

  /** The single source of truth for cart money math. */
  function computeTotals(session) {
    const items = Object.entries(session.cart).map(([sku, qty]) => {
      const p = product(sku);
      return { sku, title: p.title, emoji: p.emoji, qty, pricePaise: p.pricePaise, linePaise: p.pricePaise * qty };
    });
    const subtotalPaise = items.reduce((s, i) => s + i.linePaise, 0);
    const { discountPaise, clamps } = computeCouponDiscount(session);
    const payable = Math.max(0, subtotalPaise - discountPaise);
    const shippingPaise =
      items.length === 0 || payable >= CONFIG.shipping.freeAbovePaise ? 0 : CONFIG.shipping.flatPaise;
    return {
      items,
      itemCount: items.reduce((s, i) => s + i.qty, 0),
      subtotalPaise,
      discountPaise,
      couponCode: session.coupon?.code || null,
      couponClamps: clamps,
      shippingPaise,
      totalPaise: payable + shippingPaise,
    };
  }

  function draftOrder(session, totals) {
    const order = {
      orderId: uid('order'),
      providerOrderId: null,
      items: totals.items.map((i) => ({ sku: i.sku, qty: i.qty, pricePaise: i.pricePaise })),
      subtotalPaise: totals.subtotalPaise,
      discountPaise: totals.discountPaise,
      couponCode: totals.couponCode,
      shippingPaise: totals.shippingPaise,
      totalPaise: totals.totalPaise,
      status: 'pending',
      attempts: 0,
      failureReason: null,
      paymentId: null,
      createdAt: nowISO(),
      paidAt: null,
    };
    session.pendingOrder = order;
    return order;
  }

  function ordersOf(sessionId) {
    return sessions.get(sessionId)?.orders ?? [];
  }

  return {
    sessions,
    getSession,
    resetSession,
    product,
    qtyInCart,
    setQty,
    computeTotals,
    draftOrder,
    ordersOf,
  };
}

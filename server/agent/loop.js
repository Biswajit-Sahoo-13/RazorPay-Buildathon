// The agent loop: message → intent (LLM if configured, deterministic NLU
// otherwise) → exactly one tool → composed reply + bounded proposals.
// The loop itself has no money powers — it can only call tools, and tools
// can only act through guardrails + audit.

import { parse } from './nlu.js';
import { OFFERS } from '../catalog.js';
import { CONFIG } from '../config.js';
import { formatINR } from '../util.js';

export function createLoop({ tools, store, llm }) {
  function publicState(session) {
    const t = store.computeTotals(session);
    return {
      totals: t,
      pendingOrder: session.pendingOrder
        ? {
            orderId: session.pendingOrder.orderId,
            totalPaise: session.pendingOrder.totalPaise,
            status: session.pendingOrder.status,
            attempts: session.pendingOrder.attempts,
            failureReason: session.pendingOrder.failureReason,
          }
        : null,
      sessionSpendPaise: session.sessionSpendPaise,
      limits: CONFIG.limits,
      shipping: CONFIG.shipping,
    };
  }

  function cartSummary(session) {
    const t = store.computeTotals(session);
    if (!t.items.length) return { ok: true, status: 'ok', message: 'Your cart is empty. Say "find tea" or "gift under 500" to start.' };
    const lines = t.items.map((i) => `• ${i.qty} × ${i.emoji} ${i.title} — ${formatINR(i.linePaise)}`).join('\n');
    const discount = t.discountPaise ? `\nDiscount (${t.couponCode}): −${formatINR(t.discountPaise)}` : '';
    return {
      ok: true,
      status: 'ok',
      message: `**Cart**\n${lines}\nSubtotal: ${formatINR(t.subtotalPaise)}${discount}\nShipping: ${t.shippingPaise ? formatINR(t.shippingPaise) : 'FREE'}\n**Total: ${formatINR(t.totalPaise)}**`,
      data: { totals: t },
    };
  }

  async function handleChat(session, message) {
    const pending = !!session.pendingOrder;
    let parsed = llm ? await llm.parseIntent(message, { hasPendingOrder: pending }) : null;
    const via = parsed ? 'llm' : 'rules';
    if (!parsed) parsed = parse(message, { hasPendingOrder: pending });
    const { intent, slots } = parsed;

    let result;
    let proposals = [];

    switch (intent) {
      case 'greet':
        result = {
          ok: true,
          status: 'ok',
          message: "Namaste! I'm the MasalaMart growth agent. I can find products, build your cart, apply coupons and check you out — every money move I make is explained, bounded and audited. Try: *gift under 500* or *2 masala chai*.",
        };
        break;
      case 'help':
        result = {
          ok: true,
          status: 'ok',
          message: [
            '**What I can do**',
            '• `find tea` / `gift under 500` — search the catalog',
            '• `add 2 masala chai` — build the cart',
            '• `what pairs with the coffee?` — cross-sell proposals',
            '• `apply WELCOME10` — coupons (policy-capped, explained)',
            '• `checkout` — draft an order (never charges)',
            '• Pay via the checkout panel — the only way money moves',
            '',
            `Bounds: ≤ ${formatINR(CONFIG.limits.maxPerTransactionPaise)} per order, ≤ ${formatINR(CONFIG.limits.maxSessionSpendPaise)} per session, ≤ ${CONFIG.limits.maxQtyPerSku}/SKU, coupons ≤ ${CONFIG.limits.couponMaxPercent}% & ${formatINR(CONFIG.limits.couponMaxPaise)}.`,
          ].join('\n'),
        };
        break;
      case 'find':
        result = tools.searchCatalog(session, { query: slots.query, budgetPaise: slots.budgetPaise });
        break;
      case 'info':
        result = tools.info(session, slots);
        break;
      case 'add': {
        result = tools.addToCart(session, slots);
        if (result.ok) {
          const rec = tools.recommend(session, { sku: slots.sku });
          proposals = rec.proposals;
          if (proposals.length) result.message += `\n\nIt pairs with **${proposals[0].title}** (${formatINR(proposals[0].pricePaise)}) — want it?`;
        }
        break;
      }
      case 'remove':
        result = tools.removeFromCart(session, slots);
        break;
      case 'recommend': {
        const rec = tools.recommend(session, { sku: slots.sku });
        proposals = rec.proposals;
        result = proposals.length
          ? { ok: true, status: 'ok', message: 'Here’s what I can justify — each has a reason, and I cap myself at two per turn:' }
          : { ok: true, status: 'ok', message: 'Nothing I can justify upselling right now — a quiet cart beats a noisy one.' };
        break;
      }
      case 'coupon':
        if (slots.code) {
          result = tools.applyCoupon(session, slots);
        } else {
          result = {
            ok: true,
            status: 'ok',
            message: `Live offers: ${OFFERS.map((o) => `**${o.code}** — ${o.description}`).join(' | ')}`,
          };
        }
        break;
      case 'cart':
        result = cartSummary(session);
        break;
      case 'checkout':
        result = tools.checkout(session);
        break;
      case 'confirm':
        // The agent CANNOT confirm: userGate is false here by construction.
        // This refusal is the confirmation-gate demo — and it is audited.
        result = await tools.payConfirm(session, { userGate: false, token: session.pendingOrder?.confirmToken ?? null });
        break;
      case 'reset': {
        store.resetSession(session.id);
        result = { ok: true, status: 'ok', message: 'Fresh start — cart cleared, coupon removed.' };
        break;
      }
      default:
        result = {
          ok: true,
          status: 'ok',
          message: `I didn't quite get "*${String(message).slice(0, 60)}*". Try "find tea", "add 2 masala chai", "what pairs with coffee?", "apply WELCOME10" or "checkout".`,
        };
    }

    return { intent, via, status: result.status, reply: result.message, proposals, data: result.data ?? null, state: publicState(session) };
  }

  return { handleChat, cartSummary, publicState };
}

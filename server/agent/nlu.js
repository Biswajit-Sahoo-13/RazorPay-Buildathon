// Deterministic NLU — runs fully offline with zero dependencies. It maps a
// user message to {intent, slots} over the same tool set an LLM adapter
// would drive (see llm.js). Rule-based on purpose: in a money-adjacent agent,
// the parsing layer must be inspectable, and the guardrails do not trust it
// either way.

import { PRODUCTS, OFFERS, findProduct } from '../catalog.js';

const NUM_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  couple: 2, 'a': 1, an: 1, single: 1, pair: 2,
};

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s₹]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function extractQty(text) {
  const digit = text.match(/\b(\d{1,2})\b/);
  if (digit) return Math.min(Number.parseInt(digit[1], 10), 99);
  for (const [w, n] of Object.entries(NUM_WORDS)) {
    if (new RegExp(`\\b${w}\\b`).test(text)) return n;
  }
  return 1;
}

function extractBudget(text) {
  const m = text.match(/(?:under|below|less than|max|upto|up to|within)\s*₹?\s*(\d{2,6})/);
  return m ? Number.parseInt(m[1], 10) * 100 : null;
}

/** Best-matching product for free text (aliases >> title words >> tags). */
export function matchProduct(text) {
  const q = normalize(text);
  if (!q) return null;
  let best = null;
  let bestScore = 0;
  for (const p of PRODUCTS) {
    let score = 0;
    if (p.aliases.some((a) => a === q) || q.includes(p.sku)) score = 100;
    else if (p.aliases.some((a) => q.includes(a))) score = Math.max(score, 80);
    const qTokens = q.split(' ');
    const pTokens = `${p.title} ${p.tags.join(' ')} ${p.category}`.toLowerCase().split(/\s+/);
    const overlap = qTokens.filter((t) => t.length > 2 && pTokens.includes(t)).length;
    score = Math.max(score, overlap * 25);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= 25 ? { product: best, score: bestScore } : null;
}

/** Ranked search over title/aliases/tags/category — used by find intent. */
export function searchProducts(query, budgetPaise = null) {
  const q = normalize(query);
  const qTokens = q.split(' ').filter((t) => t.length > 1);
  return PRODUCTS.filter((p) => (budgetPaise == null || p.pricePaise <= budgetPaise))
    .map((p) => {
      const hay = `${p.title} ${p.description} ${p.category} ${p.tags.join(' ')} ${p.aliases.join(' ')}`.toLowerCase();
      const hits = qTokens.filter((t) => hay.includes(t)).length;
      return { product: p, score: hits };
    })
    .filter((r) => r.score > 0 || qTokens.length === 0)
    .sort((a, b) => b.score - a.score || a.product.pricePaise - b.product.pricePaise)
    .slice(0, 4)
    .map((r) => r.product);
}

function extractCoupon(text) {
  const up = String(text || '').toUpperCase();
  const found = OFFERS.find((o) => new RegExp(`\\b${o.code}\\b`).test(up));
  return found ? found.code : null;
}

/**
 * Parse a message into an intent. `hasPendingOrder` lets "yes / confirm /
 * proceed" resolve to the confirm intent, which the loop then routes into
 * the structural gate (and refuses on the agent's behalf).
 */
export function parse(message, { hasPendingOrder = false } = {}) {
  const text = normalize(message);
  const raw = String(message || '');
  const productHit = matchProduct(text);

  if (hasPendingOrder && /\b(yes|yeah|yep|confirm|go ahead|proceed|pay now|do it|sure)\b/.test(text)) {
    return { intent: 'confirm', slots: {} };
  }
  if (extractCoupon(raw)) return { intent: 'coupon', slots: { code: extractCoupon(raw) } };
  if (/\b(coupon|promo|discount code|voucher)\b/.test(text)) return { intent: 'coupon', slots: { code: null } };

  if (/\b(check ?out|place (the )?order|purchase|buy now|complete (the )?order|i'?m done|pay)\b/.test(text)) {
    return { intent: 'checkout', slots: {} };
  }
  if (/\b(remove|delete|drop|take out|don'?t want|without|cancel the)\b/.test(text) && productHit) {
    return { intent: 'remove', slots: { sku: productHit.product.sku, qty: extractQty(text) } };
  }
  if (
    /\b(add|put|take|i'?ll take|i will take|give me|get me|i want|i need|i would like|keep)\b/.test(text) && productHit
  ) {
    return { intent: 'add', slots: { sku: productHit.product.sku, qty: extractQty(text) } };
  }
  // Bare "2 masala chai" / "two filters" with no verb.
  if (productHit && productHit.score >= 80 && (/\b\d{1,2}\b/.test(text) || Object.keys(NUM_WORDS).some((w) => new RegExp(`\\b${w}\\b`).test(text)))) {
    return { intent: 'add', slots: { sku: productHit.product.sku, qty: extractQty(text) } };
  }

  if (/\b(suggest|recommend|what else|anything else|pair(?:s|ed|ing)?|go(?:es)? with|complement|bundle|together|cross.?sell)\b/.test(text)) {
    return { intent: 'recommend', slots: { sku: productHit?.product.sku ?? null } };
  }
  if (/\b(find|show|search|looking for|do you have|list|browse|what do you (sell|have)|options|gift)\b/.test(text) || extractBudget(text)) {
    return { intent: 'find', slots: { query: text, budgetPaise: extractBudget(text) } };
  }
  if (/\b(cart|basket|summary|so far|what'?s in|total)\b/.test(text)) return { intent: 'cart', slots: {} };
  if (/\b(reset|clear|start over|empty)\b/.test(text)) return { intent: 'reset', slots: {} };
  if (/^(hi|hello|hey|namaste|good (morning|afternoon|evening))\b/.test(text)) return { intent: 'greet', slots: {} };
  if (/\b(help|what can you|how do (i|you)|commands|what do you do)\b/.test(text)) return { intent: 'help', slots: {} };

  if (productHit) return { intent: 'info', slots: { sku: productHit.product.sku } };
  return { intent: 'unknown', slots: { query: text } };
}

// Merchant catalog + the agent-readable catalog feed (/catalog.json).
// The feed is a machine-consumable "how to buy from this merchant" contract —
// the artifact that makes MasalaMart transactable by an AI buyer, not just a
// pretty product list.

import { CONFIG } from './config.js';

/** All prices in paise. `complements` powers the cross-sell agent. */
export const PRODUCTS = [
  {
    sku: 'tea-masala',
    title: 'Masala Chai — Assam CTC, 250g',
    emoji: '🍵',
    category: 'tea',
    pricePaise: 24_900,
    stock: 42,
    description: 'House blend of Assam CTC with cardamom, ginger and clove. Strong enough for two boils.',
    aliases: ['masala chai', 'chai', 'masala tea', 'tea', 'cutting chai'],
    tags: ['bestseller', 'tea', 'spicy', 'everyday'],
    complements: ['cookie-butter', 'honey-wild'],
  },
  {
    sku: 'tea-darjeeling',
    title: 'Darjeeling First Flush, 100g',
    emoji: '🍃',
    category: 'tea',
    pricePaise: 44_900,
    stock: 18,
    description: 'Spring-picked muscatel from a single estate. Light, floral, best without milk.',
    aliases: ['darjeeling', 'first flush', 'darjeeling tea'],
    tags: ['premium', 'tea', 'gift'],
    complements: ['honey-wild', 'gift-hamper'],
  },
  {
    sku: 'coffee-filter',
    title: 'Filter Coffee — Peaberry Blend, 500g',
    emoji: '☕',
    category: 'coffee',
    pricePaise: 39_900,
    stock: 25,
    description: '80/20 coffee-chicory South Indian filter blend, dark roast.',
    aliases: ['filter coffee', 'coffee', 'south indian coffee'],
    tags: ['bestseller', 'coffee'],
    complements: ['mug-kulhad', 'coffee-beans'],
  },
  {
    sku: 'coffee-beans',
    title: 'Arabica Beans — Chikmagalur, 250g',
    emoji: '🫘',
    category: 'coffee',
    pricePaise: 54_900,
    stock: 12,
    description: 'Whole-bean single-origin arabica, medium roast, honey-processed.',
    aliases: ['arabica', 'beans', 'coffee beans', 'whole bean'],
    tags: ['premium', 'coffee'],
    complements: ['mug-kulhad'],
  },
  {
    sku: 'spice-garam',
    title: 'Garam Masala — Stone Ground, 100g',
    emoji: '🌶️',
    category: 'spice',
    pricePaise: 19_900,
    stock: 60,
    description: 'Twelve-spice stone-ground garam masala, roasted in small batches.',
    aliases: ['garam masala', 'masala', 'spice'],
    tags: ['spice', 'everyday'],
    complements: ['spice-box', 'tea-masala'],
  },
  {
    sku: 'spice-box',
    title: 'Stainless Steel Spice Box — 7 Tins',
    emoji: '🫙',
    category: 'kitchen',
    pricePaise: 89_900,
    stock: 8,
    description: 'Classic masala dabba with a clear lid and seven airtight tins.',
    aliases: ['spice box', 'dabba', 'masala dabba'],
    tags: ['kitchen', 'gift'],
    complements: ['spice-garam'],
  },
  {
    sku: 'cookie-butter',
    title: 'Butter Cookies — Bakery Style, 400g',
    emoji: '🍪',
    category: 'biscuit',
    pricePaise: 17_900,
    stock: 80,
    description: 'Dunkable butter cookies. The chai’s favourite companion.',
    aliases: ['cookies', 'butter cookies', 'biscuits'],
    tags: ['snack'],
    complements: ['tea-masala', 'tea-darjeeling'],
  },
  {
    sku: 'honey-wild',
    title: 'Wild Forest Honey, 500g',
    emoji: '🍯',
    category: 'pantry',
    pricePaise: 34_900,
    stock: 30,
    description: 'Raw, unpasteurised forest honey from the Nilgiris.',
    aliases: ['honey', 'forest honey'],
    tags: ['pantry', 'gift'],
    complements: ['tea-masala', 'tea-darjeeling'],
  },
  {
    sku: 'mug-kulhad',
    title: 'Ceramic Kulhad Cups — Set of 6',
    emoji: '🥛',
    category: 'kitchen',
    pricePaise: 29_900,
    stock: 15,
    description: 'Terracotta-glazed kulhad-shaped cups, microwave safe.',
    aliases: ['kulhad', 'cups', 'mug', 'mugs'],
    tags: ['kitchen'],
    complements: ['coffee-filter', 'tea-masala'],
  },
  {
    sku: 'gift-hamper',
    title: 'Festive Gift Hamper — Chai & Coffee',
    emoji: '🎁',
    category: 'hamper',
    pricePaise: 149_900,
    stock: 1, // intentionally scarce: powers the out-of-stock-at-checkout demo
    description: 'Masala chai, filter coffee, honey and kulhads in a gift box — ₹1,946 of product for ₹1,499.',
    aliases: ['hamper', 'gift hamper', 'gift', 'festive hamper', 'gift box'],
    tags: ['gift', 'premium', 'bundle'],
    complements: [],
  },
];

export const OFFERS = [
  {
    code: 'WELCOME10',
    type: 'percent',
    value: 10,
    description: '10% off the whole cart for first-time buyers.',
  },
  {
    code: 'CHAI20',
    type: 'percent',
    value: 20,
    appliesToCategory: 'tea',
    maxDiscountPaise: 30_000,
    description: '20% off tea items only (up to ₹300 off).',
  },
  {
    code: 'SAVE30',
    type: 'percent',
    value: 30,
    description: 'Headline 30% off. Policy caps every coupon at 20% / ₹1,000 — the agent must clamp and say so.',
  },
  {
    code: 'FLAT50',
    type: 'flat',
    value: 5_000,
    minCartPaise: 49_900,
    description: '₹50 off on carts of ₹499 and above.',
  },
  {
    code: 'COMEBACK10',
    type: 'percent',
    value: 10,
    description: 'Cart-recovery coupon — 10% off, issued only by the campaign agent, once per session.',
  },
];

export function findProduct(skuOrAlias) {
  const q = String(skuOrAlias || '').toLowerCase().trim();
  if (!q) return null;
  return (
    PRODUCTS.find((p) => p.sku === q) ||
    PRODUCTS.find((p) => p.aliases.includes(q)) ||
    PRODUCTS.find((p) => p.title.toLowerCase() === q) ||
    null
  );
}

export function findOffer(code) {
  const c = String(code || '').toUpperCase().trim();
  return OFFERS.find((o) => o.code === c) || null;
}

/**
 * The agent-readable catalog feed. This is what an external AI buyer (or an
 * in-app shopping agent) ingests to become able to transact with MasalaMart:
 * products, offers, stock, shipping/policy rules, and an explicit
 * how-to-buy contract with bounds up front — so the agent's constraints are
 * knowable before any money action, not discovered after.
 */
export function buildAgentCatalog() {
  return {
    schema_version: 'agent-catalog/1.0',
    issued_at: new Date().toISOString(),
    merchant: {
      id: 'masalamart',
      name: CONFIG.merchant.name,
      tagline: CONFIG.merchant.tagline,
      support: CONFIG.merchant.supportEmail,
      payments: {
        provider: CONFIG.provider,
        currency: 'INR',
        methods: ['upi', 'card', 'netbanking', 'wallet'],
        captures: 'manual_after_user_confirmation', // the gate, stated in-band
      },
    },
    products: PRODUCTS.map((p) => ({
      sku: p.sku,
      title: p.title,
      emoji: p.emoji,
      description: p.description,
      category: p.category,
      price_paise: p.pricePaise,
      stock: p.stock,
      complements: p.complements,
      tags: p.tags,
    })),
    offers: OFFERS.map((o) => ({
      code: o.code,
      type: o.type,
      value: o.value,
      min_cart_paise: o.minCartPaise ?? 0,
      applies_to_category: o.appliesToCategory ?? '*',
      max_discount_paise: o.maxDiscountPaise ?? null,
      description: o.description,
    })),
    policies: {
      refund_window_days: 7,
      shipping: {
        free_above_paise: CONFIG.shipping.freeAbovePaise,
        flat_paise: CONFIG.shipping.flatPaise,
      },
      agent_bounds: {
        max_per_transaction_paise: CONFIG.limits.maxPerTransactionPaise,
        max_session_spend_paise: CONFIG.limits.maxSessionSpendPaise,
        max_qty_per_sku: CONFIG.limits.maxQtyPerSku,
        coupon_max_percent: CONFIG.limits.couponMaxPercent,
        coupon_max_paise: CONFIG.limits.couponMaxPaise,
        note: 'Every money action is bounded server-side; the agent cannot waive these.',
      },
      confirmation_gate: 'No payment is captured without an explicit end-user confirmation gesture bound to a single-use token.',
      audit: { format: 'hash-chained JSONL', endpoint: '/api/audit', verify: '/api/audit/verify' },
    },
    how_to_buy: [
      '1. Ingest this catalog (prices in paise, INR).',
      '2. Build a cart with add_to_cart; respect stock and per-SKU quantity bounds.',
      '3. Optionally apply a coupon code from offers; bounds may clamp it, the response explains.',
      '4. Call checkout to draft an order — this never charges money.',
      '5. Show the order to the human and capture their explicit confirmation.',
      '6. Confirm the payment with the single-use token issued at checkout.',
      '7. Read the agent-readable receipt at /api/receipt/:orderId.',
    ],
  };
}

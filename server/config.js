// Zero-dependency config. Loads a local .env if present (no dotenv needed),
// then exposes CONFIG with sane, documented defaults.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Minimal .env loader — KEY=VALUE lines, # comments, quoted values supported.
(function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
})();

const int = (name, fallback) => {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

// Which payment provider to use. If real Razorpay test keys are present the
// Razorpay adapter wins, unless PAYMENT_PROVIDER pins 'mock'.
function pickProvider() {
  const pinned = (process.env.PAYMENT_PROVIDER || '').toLowerCase();
  if (pinned === 'mock' || pinned === 'razorpay') return pinned;
  return process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET ? 'razorpay' : 'mock';
}

export const CONFIG = {
  port: int('PORT', 3000),
  provider: pickProvider(),
  merchant: {
    name: 'MasalaMart',
    tagline: 'Small-batch teas, coffees & spices — sold to humans and AI agents alike.',
    supportEmail: 'support@masalamart.example',
  },
  limits: {
    // All money values in paise. ₹5,000 / ₹15,000 caps make the "bounded"
    // bar visible in a demo without blocking realistic carts.
    maxPerTransactionPaise: int('MAX_PER_TRANSACTION_PAISE', 500_000),
    maxSessionSpendPaise: int('MAX_SESSION_SPEND_PAISE', 1_500_000),
    maxQtyPerSku: int('MAX_QTY_PER_SKU', 5),
    maxCartItems: int('MAX_CART_ITEMS', 20),
    couponMaxPercent: int('COUPON_MAX_PERCENT', 20),
    couponMaxPaise: int('COUPON_MAX_PAISE', 100_000),
  },
  shipping: {
    freeAbovePaise: 49_900, // free shipping over ₹499
    flatPaise: 4_900, // otherwise ₹49 flat
  },
  campaign: {
    // Cart-recovery campaign (Campaign Orchestrator direction, lite).
    // Carts idle longer than idleMs get one bounded comeback coupon.
    idleMs: 90_000,
    code: 'COMEBACK10',
    perSessionMaxIssues: 1,
  },
  dataDir: path.join(ROOT, 'data'),
  mockSecret: process.env.MOCK_GATEWAY_SECRET || 'mock_gateway_secret_buildathon',
};

// Small shared utilities — all money math is integer paise end to end.

import crypto from 'node:crypto';

export const uid = (prefix) =>
  `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

export const nowISO = () => new Date().toISOString();

/** ₹ formatting for humans (paise → "₹1,234.50", trimming .00). */
export function formatINR(paise) {
  const n = paise / 100;
  const s = n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `₹${s.replace(/\.00$/, '')}`;
}

/** Deterministic JSON so hash chains are stable across runs. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export const sha256hex = (s) =>
  crypto.createHash('sha256').update(s).digest('hex');

export const hmacSha256hex = (secret, s) =>
  crypto.createHmac('sha256', secret).update(s).digest('hex');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

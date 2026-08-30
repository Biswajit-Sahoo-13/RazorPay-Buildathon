// Optional LLM adapter (any OpenAI-compatible endpoint: GLM, OpenAI, etc.).
// When LLM_* env vars are set, it maps a user message to the same intent/
// slots contract the deterministic NLU uses — same tools, same guardrails.
// It can only *choose* tools; it can never move money, because every tool
// result still passes through guardrails.js and the confirmation gate.
// If the call fails or returns garbage, the caller falls back to the
// deterministic parser, so the agent never goes down with the LLM.

import { PRODUCTS, OFFERS } from '../catalog.js';

const ALLOWED_INTENTS = ['find', 'add', 'remove', 'recommend', 'coupon', 'checkout', 'confirm', 'cart', 'reset', 'info', 'help', 'greet', 'unknown'];

export function createLLM() {
  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = process.env;
  if (!LLM_BASE_URL || !LLM_API_KEY || !LLM_MODEL) return null;

  const systemPrompt = [
    'You are the intent parser for "MasalaMart", an agentic storefront on Razorpay test-mode APIs.',
    'Map the user message to exactly one intent and return ONLY a JSON object: {"intent": string, "slots": object}.',
    `Allowed intents: ${ALLOWED_INTENTS.join(', ')}.`,
    'Slots: add/remove → {sku, qty:int}; find → {query, budgetPaise:int|null}; recommend → {sku|null}; coupon → {code|null}; info → {sku}. Others → {}.',
    `Valid SKUs: ${PRODUCTS.map((p) => p.sku).join(', ')}.`,
    `Valid coupon codes: ${OFFERS.map((o) => o.code).join(', ')}.`,
    'budgetPaise is rupees × 100 ("under 500" → 50000). If ambiguous, prefer intent "unknown".',
    hasPendingRule(),
  ].join('\n');

  function hasPendingRule() {
    return 'Intent "confirm" means the user explicitly agrees to PAY an already-drafted order (yes/confirm/proceed/pay now).';
  }

  return {
    name: `llm:${LLM_MODEL}`,

    async parseIntent(message, { hasPendingOrder = false } = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(`${LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_API_KEY}` },
          body: JSON.stringify({
            model: LLM_MODEL,
            temperature: 0,
            messages: [
              { role: 'system', content: `${systemPrompt}\nPending order exists: ${hasPendingOrder}` },
              { role: 'user', content: String(message).slice(0, 500) },
            ],
            response_format: { type: 'json_object' },
          }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
        if (!ALLOWED_INTENTS.includes(parsed.intent)) return null;
        return { intent: parsed.intent, slots: parsed.slots ?? {}, via: 'llm' };
      } catch {
        return null; // caller falls back to deterministic NLU
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

# Architecture — MasalaMart Agentic Storefront

## Components

```
┌────────────────────────────────────────────────────────────────────────────┐
│  web/ (vanilla JS)                                                          │
│  catalog rail  ·  agent chat  ·  cart + Pay button  ·  audit timeline       │
└──────────────┬─────────────────────────────────────────────────────────────┘
               │ /api/chat · /api/checkout · /api/confirm · /api/audit
┌──────────────▼─────────────────────────────────────────────────────────────┐
│  server/index.js (zero-dep http)                                            │
│                                                                             │
│  agent/loop ──► agent/nlu (deterministic)  ── or ──► agent/llm (optional)   │
│       │                                                                     │
│       ▼  one tool per turn                                                  │
│  agent/tools ──► guardrails.js ──► store.js (carts, paise pricing, orders)  │
│       │              │ passes? mutate + explain     │                       │
│       │              └── refused? audit 'blocked'   │                       │
│       ▼                                                             ▼       │
│  audit.js (hash-chained ledger, JSONL mirror)          payments/provider   │
│                                                        ├─ mock.js (default)│
│                                                        └─ razorpay.js      │
└────────────────────────────────────────────────────────────────────────────┘
```

## The money path (sequence)

```mermaid
sequenceDiagram
    participant U as Human
    participant A as Agent (chat)
    participant G as Guardrails
    participant P as Provider (mock/Razorpay)
    participant L as Audit ledger

    U->>A: "add 2 masala chai" / "apply SAVE30"
    A->>G: checkAddToCart / checkCoupon
    G-->>A: pass (+ recorded bounds) | blocked (reason)
    A->>L: cart.add / money.coupon_applied (+clamps)

    U->>A: "checkout"
    A->>G: checkCheckout (stock re-check, per-txn + session caps)
    G-->>A: pass
    A->>P: createOrder(amount, receipt)
    P-->>A: providerOrderId
    A->>L: money.order_drafted — "no charge; gate awaiting user"
    Note over A: issues single-use confirm token

    U->>A: "yes, pay now" (chat)
    A->>G: checkPaymentGate(userGate=false)
    G-->>A: REFUSED
    A->>L: money.payment_request — status gate_denied

    U->>U: clicks Pay (the only userGate=true caller)
    U->>P: charge attempt
    alt bank declines
        P-->>L: money.payment_failed (order + cart intact, retry allowed)
    else signature mismatch
        P-->>L: money.payment_failed (refused as security event)
    else verified
        P->>P: HMAC(order_id|payment_id) matches
        P-->>L: money.payment_captured (stock ↓, spend ledger ↑, token burned)
    end
```

## Bounds enforced server-side (`server/guardrails.js` + `config.js`)

| Bound | Default | Where |
|---|---|---|
| Per-transaction cap | ₹5,000 | `checkCheckout` |
| Session spend cap (paid + pending) | ₹15,000 | `checkCheckout` |
| Qty per SKU | 5 | `checkAddToCart` |
| Cart items | 20 | `checkAddToCart` |
| Stock | catalog value, re-checked at checkout | both |
| Coupon percent | 20% (clamped + explained) | `computeCouponDiscount` |
| Coupon amount | ₹1,000 | `computeCouponDiscount` |
| Recommendation volume | ≤ 2 proposals/turn | `tools.recommend` |
| Campaign issuance | ≤ 1 per session | `runCampaign` |

Every check produces `{name, pass, detail}` records that ship inside the audit event — refusals show *which* bound stopped them.

## Audit event schema

```json
{
  "id": "evt_ab12…", "seq": 7, "ts": "2026-08-30T12:15:40.112Z",
  "sessionId": "sess_…", "actor": "agent|user|system",
  "tool": "apply_coupon", "action": "money.coupon_applied",
  "status": "ok|blocked|gate_denied|failed|recovered|replay",
  "explanation": "Applied SAVE30: −₹99.60 (clamped to 20%)…",
  "reasoning": "Discount computed from catalog rules and policy caps server-side.",
  "payload": { "code": "SAVE30", "discountPaise": 9960, "clamps": ["…"] },
  "bounds": [{ "name": "policy_percent_cap", "pass": true, "detail": "…" }],
  "prevHash": "a1b2…", "hash": "c3d4…"
}
```

`hash = SHA256(prevHash + canonicalJSON(eventWithoutHash))` — canonical via sorted-key stringification so the chain verifies across processes. `GET /api/audit/verify` recomputes the whole chain; the UI surfaces the verdict in the header pill.

## Design decisions

1. **The gate is structural.** `userGate` is a parameter of `payConfirm` that only the `/api/confirm` route ever sets to `true`. The agent loop hard-codes `false`. No prompt, permission or LLM guardrail to bypass — the call simply does not exist. Attempting it is itself an audit event (`gate_denied`, actor `agent`).
2. **One bounds engine, two callers.** Agent tools and the human UI endpoints both call `guardrails.js`, so "the agent can't do what a human can't" (and vice versa) holds by construction.
3. **Deterministic-first NLU with an LLM adapter.** `nlu.js` (offline regex/slot parser) and `llm.js` (OpenAI-compatible, JSON-intent extraction) produce the same `{intent, slots}`; both funnel into the same tools. LLM failure falls back to rules, and the LLM can only pick tools — never format amounts, never sign, never confirm.
4. **Mock gateway mirrors Razorpay's contract** (order → payment → `HMAC_SHA256(order_id|payment_id, secret)` verification) so switching to real test keys changes only `payments/razorpay.js`, not the money path. With real keys there is deliberately no server-side simulation — payment must happen inside Razorpay Checkout on the client and the server only verifies.
5. **Paise integers everywhere.** No float arithmetic in pricing; ₹ formatting happens only at render edges.
6. **Refusals are first-class.** Blocked bounds, gate denials, declines and signature mismatches all become `status != ok` ledger events with human explanations — the audit trail tells the story of what the agent *refused to do*, not just what it did.

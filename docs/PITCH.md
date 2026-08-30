# 5-Minute Pitch Video Script — MasalaMart (Track 01)

> Buildathon submission format: public repo + this 5-minute video + architecture (see `docs/ARCHITECTURE.md`).
> Record the screen at http://localhost:3000 (`npm start`). Keep the audit panel visible at all times — it is the co-star.

---

**[0:00–0:30] Hook — why now**

> "NPCI's UAP and the global protocol race — ACP, AP2, x402 — are making agent-to-agent commerce the open problem of the year. Razorpay's in-app pilots are already live. But here's the gap nobody has closed: an AI agent that can *sell* — grow revenue — without a human asking 'can I trust it with my checkout?'
>
> We built MasalaMart: an agentic storefront where the agent grows revenue, the merchant is readable by any AI buyer, and **every money action is explainable, bounded and gated** — with a tamper-evident audit trail. Watch."

**[0:30–1:30] Revenue growth, with reasons**

> Type `add 2 masala chai`.

> "The agent adds ₹498 and immediately proposes two companions — cookies and honey. Notice each proposal carries its **rule**: they come from the catalog's complements graph, capped at two per turn. Growth actions are bounded too.
>
> Type `apply SAVE30`."

> "SAVE30 advertises 30% off. The agent applies it — but **clamps it to the 20% policy cap and says so**, itemized in the chat and in the ledger. The discount math is server-side; the agent can't improvise a bigger sale than policy allows."

**[1:30–2:30] The gate — the part most demos fake**

> Type `checkout`.

> "Order drafted: ₹447.40. And the agent itself tells us it **cannot** charge us. Now the honest test — type `yes, pay now`."

> "Refused. Not by a prompt — by structure. The parameter that authorizes capture physically doesn't exist on the agent's code path; only the Pay button's endpoint can set it. And look right: the refusal itself is an audited `gate_denied` event, actor: agent."

**[2:30–3:30] The failure, handled gracefully**

> "Now the failure demo. Tick *Force decline*, press Pay."

> "The bank declines. The agent says exactly that: **nothing was charged**, your order is intact, here's how to retry. The order survives with its attempt count and failure reason. Untick, press Pay again — **same order, same token, paid**. Stock decremented, session spend ledger updated, and an agent-readable receipt is ready for the buyer's AI to reconcile."

**[3:30–4:15] Sellable to AI buyers + the tamper check**

> Open `/catalog.json` in a second tab.

> "This is the same merchant as a **machine-readable contract**: products, stock, offers, policies, the agent bounds themselves, and a seven-step how-to-buy. Any external AI buyer can ingest this and transact. Receipts come back as `agent-receipt/1.0` JSON."

> "And because money was involved, we made the ledger tamper-evident: each event's SHA-256 binds the previous hash. Press *Verify* — chain intact. Run the tamper control — one event rewritten — verify again: **broken at #N**. You don't have to trust the agent's story; you can check it."

**[4:15–5:00] Stack + close**

> "The whole thing is **zero-dependency Node** — `npm start`, runs offline; thirty tests plus a seventeen-check HTTP smoke suite. Plug in real Razorpay test keys and the same verified code path runs against the live Orders API; plug in an LLM and it drives the same guarded tools — the ceiling is identical.
>
> We didn't build a chatbot on top of a payment form. We built the **control plane for an agent that touches money** — and then let it grow revenue inside it. MasalaMart: sellable to humans and AI agents alike. Thank you."

---

### Shot list / recording notes

| Beat | Action on screen | Panel to keep in frame |
|---|---|---|
| 0:30 | type `add 2 masala chai` | proposals with `rule:` chips |
| 1:00 | type `apply SAVE30` | clamp sentence in chat + `money.coupon_applied` event |
| 1:40 | type `checkout` then `yes, pay now` | red `gate_denied` event (actor: agent) |
| 2:40 | Force decline → Pay → untick → Pay | `money.payment_failed` → `money.payment_captured`, receipt dialog |
| 3:35 | open `/catalog.json` | `policies.agent_bounds` + `how_to_buy` |
| 4:05 | Verify → Tamper → Verify | pill: 🔗 intact → 💥 BROKEN at #N |

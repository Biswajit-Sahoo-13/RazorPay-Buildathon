import { useEffect, useRef, useState } from 'react';
import { Bot, User, ShoppingCart, Lock, CheckCircle2, XCircle, AlertTriangle, Ban, Sparkles, MessageSquare } from 'lucide-react';
import { inr, renderMd } from '../api.js';

const STATUS_ICON = {
  ok: <CheckCircle2 />,
  blocked: <Ban />,
  failed: <AlertTriangle />,
  gate_denied: <XCircle />,
};

function ActionChip({ intent, via, status }) {
  if (!intent) return null;
  return (
    <span className={`action-chip ${status}`}>
      {STATUS_ICON[status] ?? <CheckCircle2 />}
      {intent} · {via} · {status}
    </span>
  );
}

function ProposalCard({ p, onAdd }) {
  return (
    <div className="proposal">
      <div className="tile">{p.emoji}</div>
      <div>
        <h4>{p.title} — {inr(p.pricePaise)}</h4>
        <p className="pitch">{p.pitch}</p>
        <span className="rule">{p.rule}</span>
      </div>
      <button className="btn-add" onClick={() => onAdd(p.sku)}>Add</button>
    </div>
  );
}

function Bubble({ m, onAdd }) {
  const isUser = m.role === 'user';
  return (
    <div className={`row ${isUser ? 'user' : 'agent'}`}>
      <div className={`avatar ${isUser ? 'user-av' : ''}`}>{isUser ? <User /> : <Bot />}</div>
      <div className={`bubble ${isUser ? 'user' : 'agent'}`}>
        <span dangerouslySetInnerHTML={{ __html: renderMd(m.text) }} />
        {m.intent && <br />}
        <ActionChip intent={m.intent} via={m.via} status={m.status} />
        {!isUser && m.proposals?.length > 0 && (
          <div className="proposals">
            {m.proposals.map((p) => <ProposalCard key={p.sku} p={p} onAdd={onAdd} />)}
          </div>
        )}
      </div>
    </div>
  );
}

const SUGGESTIONS = ['gift under 500', 'add 2 masala chai', 'what pairs with the coffee?', 'apply WELCOME10', 'apply SAVE30', "what's in my cart?", 'checkout', 'yes, pay now'];

function CartPanel({ state, token, onCheckout, onPay }) {
  const [forceFail, setForceFail] = useState(false);
  const t = state?.totals;
  const pending = state?.pendingOrder;
  const paid = pending?.status === 'paid';

  if (!t) return null;
  return (
    <div className="cart-card">
      {t.items.length === 0 && (
        <p className="cart-empty"><ShoppingCart /> Cart is empty — try a suggestion below.</p>
      )}
      {t.items.length > 0 && (
        <>
          <div className="cart-lines">
            {t.items.map((i) => (
              <div className="cl" key={i.sku}>
                <span className="t">{i.qty} × {i.emoji} {i.title}</span>
                <span className="v">{inr(i.linePaise)}</span>
              </div>
            ))}
          </div>
          <div className="cart-math">
            <div className="row"><span>Subtotal</span><span>{inr(t.subtotalPaise)}</span></div>
            {t.discountPaise > 0 && <div className="row disc"><span>Discount ({t.couponCode})</span><span>−{inr(t.discountPaise)}</span></div>}
            <div className="row"><span>Shipping</span><span>{t.shippingPaise ? inr(t.shippingPaise) : 'FREE'}</span></div>
            <div className="row total"><span>Payable</span><span>{inr(t.totalPaise)}</span></div>
          </div>
        </>
      )}

      {paid ? (
        <p className="paid-note" style={{ marginTop: 10 }}><CheckCircle2 /> Paid — order confirmed. Receipt opened.</p>
      ) : pending ? (
        <div className="pay-box">
          <div className="pay-head">
            <span className="t">Order {pending.orderId.slice(0, 14)}…{pending.attempts ? ` · attempt ${pending.attempts + 1}` : ''}</span>
            <span className="a">{inr(pending.totalPaise)}</span>
          </div>
          {pending.failureReason && <p className="pay-sub"><span className="fail">Last failure:</span> {pending.failureReason}</p>}
          <label className="demo-toggle">
            <input type="checkbox" checked={forceFail} onChange={(e) => setForceFail(e.target.checked)} />
            Force decline (demo the failure path)
          </label>
          <button className="btn btn-pay" onClick={() => onPay(forceFail)}>
            <Lock size={15} /> Pay now
          </button>
          <p className="gate-note"><Lock /> This click is the confirmation gate — the agent cannot press it for you.</p>
        </div>
      ) : (
        t.items.length > 0 && (
          <div className="cart-actions">
            <button className="btn btn-primary" onClick={onCheckout}>
              <Lock size={14} /> Checkout — draft order
            </button>
          </div>
        )
      )}
    </div>
  );
}

export default function ChatColumn({ messages, busy, state, token, onSend, onCheckout, onPay }) {
  const [text, setText] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const submit = (e) => {
    e.preventDefault();
    onSend(text);
    setText('');
  };

  return (
    <section className="panel chat-col">
      <div className="panel-head">
        <span className="panel-title"><MessageSquare /> Growth Agent</span>
        <span className="pill accent"><Sparkles /> every action audited</span>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.map((m, i) => <Bubble key={i} m={m} onAdd={(sku) => onSend(`add 1 ${sku}`)} />)}
        {busy && (
          <div className="row agent">
            <div className="avatar"><Bot /></div>
            <div className="bubble agent typing"><span /><span /><span /></div>
          </div>
        )}
      </div>

      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="suggestion" onClick={() => onSend(s)}>{s}</button>
        ))}
      </div>

      <CartPanel state={state} token={token} onCheckout={onCheckout} onPay={onPay} />

      <form className="chat-input" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Try: gift under 500 · add 2 masala chai · what pairs with coffee?"
          autoComplete="off"
        />
        <button className="btn btn-primary" type="submit" disabled={busy}>Send</button>
      </form>
    </section>
  );
}

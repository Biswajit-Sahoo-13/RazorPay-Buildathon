import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api, getSessionId, inr } from './api.js';
import TopBar from './components/TopBar.jsx';
import CatalogRail from './components/CatalogRail.jsx';
import ChatColumn from './components/ChatColumn.jsx';
import AuditTrail from './components/AuditTrail.jsx';
import ReceiptDialog from './components/ReceiptDialog.jsx';

const WELCOME = {
  role: 'agent',
  text:
    "Namaste! I'm the **MasalaMart growth agent** 🛵\nI find products, build your cart, apply coupons and draft your order — and every money move I make is **explained, bounded and audited** (watch the right panel).\n\nI can't charge you: payment happens only when **you** press Pay.",
  intent: null,
};

export default function App() {
  const [config, setConfig] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [messages, setMessages] = useState([WELCOME]);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(null);
  const [audit, setAudit] = useState({ events: [], verify: { valid: true, count: 0 } });
  const [filter, setFilter] = useState('all');
  const [receipt, setReceipt] = useState(null);

  const refreshAudit = useCallback(async () => {
    const data = await api(`/api/audit?limit=150`);
    setAudit(data);
  }, []);

  const refreshCatalog = useCallback(async () => setCatalog(await api('/catalog.json')), []);

  useEffect(() => {
    (async () => {
      setConfig(await api('/api/config'));
      await Promise.all([refreshCatalog(), refreshAudit()]);
      const { state } = await api(`/api/state?sessionId=${encodeURIComponent(getSessionId())}`);
      setState(state);
    })();
  }, [refreshAudit, refreshCatalog]);

  const pushMessage = (m) => setMessages((ms) => [...ms, m]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || busy) return;
    pushMessage({ role: 'user', text });
    setBusy(true);
    try {
      const resp = await api('/api/chat', { message: text });
      pushMessage({ role: 'agent', text: resp.reply, intent: resp.intent, via: resp.via, status: resp.status, proposals: resp.proposals ?? [] });
      if (resp.data?.token) setToken(resp.data.token);
      if (resp.state) setState(resp.state);
      await refreshAudit();
    } finally {
      setBusy(false);
    }
  }, [busy, refreshAudit]);

  const doCheckout = useCallback(async () => {
    const resp = await api('/api/checkout', {});
    if (resp.data?.token) setToken(resp.data.token);
    if (resp.state) setState(resp.state);
    pushMessage({ role: 'agent', text: resp.message, intent: 'checkout', via: 'user click', status: resp.status });
    await refreshAudit();
  }, [refreshAudit]);

  const doPay = useCallback(async (forceFail) => {
    const resp = await api('/api/confirm', { token, simulate: forceFail ? 'failure' : null });
    if (resp.status === 'ok') setToken(null);
    if (resp.state) setState(resp.state);
    pushMessage({ role: 'agent', text: resp.message, intent: 'confirm_payment', via: 'user click', status: resp.status });
    await refreshAudit();
    if (resp.data?.order?.status === 'paid') {
      await refreshCatalog();
      setReceipt(await api(`/api/receipt?orderId=${encodeURIComponent(resp.data.order.orderId)}`));
    }
  }, [token, refreshAudit, refreshCatalog]);

  const demo = useCallback(async (kind) => {
    if (kind === 'stock') {
      await api('/api/dev/set-stock', { sku: 'gift-hamper', qty: 0 });
      await refreshCatalog();
      await refreshAudit();
      pushMessage({ role: 'agent', intent: 'demo', via: 'system', status: 'ok', text: '🎬 Demo: **another buyer just took the last Festive Gift Hamper** (stock → 0). Now try **checkout** to watch the agent handle the out-of-stock failure gracefully.' });
    } else if (kind === 'campaign') {
      const r = await api('/api/campaigns/run', {});
      pushMessage({ role: 'agent', intent: 'campaign.run', via: 'system', status: 'ok', text: r.issuedCount
        ? `📣 Cart-recovery campaign ran: ${r.issuedCount} coupon(s) issued (${r.issued.map((x) => x.code).join(', ')}). Carts idle > ${Math.round(r.idleThresholdMs / 1000)}s were targeted, one issue per session max.`
        : `📣 Campaign ran — no eligible carts (needs a cart idle > ${Math.round(r.idleThresholdMs / 1000)}s with no coupon yet).` });
      await refreshAudit();
    } else if (kind === 'tamper') {
      await api('/api/dev/tamper', {});
      await refreshAudit();
      pushMessage({ role: 'agent', intent: 'demo', via: 'system', status: 'ok', text: '🧨 Demo: the newest ledger event was rewritten in place. The header pill now shows the chain is **broken** — tampering is detectable by construction.' });
    } else if (kind === 'reset') {
      sessionStorage.removeItem('mm_sess');
      setToken(null);
      setMessages([WELCOME]);
      const { state } = await api('/api/dev/reset', {});
      setState(state);
      await Promise.all([refreshAudit(), refreshCatalog()]);
    }
  }, [refreshAudit, refreshCatalog]);

  return (
    <>
      <TopBar config={config} chain={audit.verify} onVerify={refreshAudit} />
      <main className="shell">
        <CatalogRail catalog={catalog} onAdd={(sku) => sendMessage(`add 1 ${sku}`)} />
        <ChatColumn
          messages={messages}
          busy={busy}
          state={state}
          token={token}
          onSend={sendMessage}
          onCheckout={doCheckout}
          onPay={doPay}
        />
        <AuditTrail audit={audit} filter={filter} setFilter={setFilter} onDemo={demo} />
      </main>
      {receipt && <ReceiptDialog receipt={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

export { inr };

/* MasalaMart storefront — vanilla JS, no build step, no external requests. */

const S = {
  sessionId: sessionStorage.getItem('mm_sess') || (() => {
    const id = 'sess_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    sessionStorage.setItem('mm_sess', id);
    return id;
  })(),
  config: null,
  catalog: null,
  token: null, // single-use payment token from the latest checkout
  filter: 'all',
};

const $ = (id) => document.getElementById(id);

/* ── tiny helpers ─────────────────────────────────────────────────────── */
async function api(path, body = null) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify({ sessionId: S.sessionId, ...body }) : undefined,
  });
  return res.json();
}

const inr = (p) => '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const initials = (t) => (String(t).match(/[A-Za-z]/g) || []).slice(0, 2).join('').toUpperCase() || 'MM';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function md(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    .replace(/\n/g, '<br>');
}
const timeOf = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/* ── chat rendering ───────────────────────────────────────────────────── */
function bubble(kind, html) {
  const el = document.createElement('div');
  el.className = `msg ${kind}`;
  el.innerHTML = html;
  $('chat').appendChild(el);
  $('chat').scrollTop = $('chat').scrollHeight;
  return el;
}

function chipFor(intent, via, status) {
  const label = { ok: 'ok', blocked: 'blocked', failed: 'failed', gate_denied: 'refused' }[status] ?? '·';
  return `<span class="action-chip ${status}">${label} ${esc(intent)} · via ${esc(via)} · ${esc(status)}</span>`;
}

function renderProposals(proposals) {
  if (!proposals?.length) return '';
  const wrap = document.createElement('div');
  wrap.className = 'proposals';
  wrap.innerHTML = proposals
    .map(
      (p) => `
      <div class="proposal" data-sku="${esc(p.sku)}">
        <div class="emoji mono">${initials(p.title)}</div>
        <div>
          <h4>${esc(p.title)} — ${inr(p.pricePaise)}</h4>
          <p class="pitch">${esc(p.pitch)}</p>
          <span class="rule">${esc(p.rule)}</span>
        </div>
        <button class="add-btn">Add</button>
      </div>`
    )
    .join('');
  wrap.querySelectorAll('.add-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      const sku = btn.closest('.proposal').dataset.sku;
      sendMessage(`add 1 ${sku}`);
    })
  );
  return wrap;
}

async function renderAgentTurn(resp) {
  const el = bubble('agent', `${md(resp.reply)}<br>${chipFor(resp.intent, resp.via, resp.status)}`);
  const props = renderProposals(resp.proposals);
  if (props) el.appendChild(props);
  if (resp.data?.token) S.token = resp.data.token;
  if (resp.state) updateState(resp.state);
  refreshAudit();
}

async function sendMessage(text) {
  if (!text.trim()) return;
  bubble('user', md(text));
  const resp = await api('/api/chat', { message: text });
  await renderAgentTurn(resp);
}

/* ── state / cart / pay box ───────────────────────────────────────────── */
function updateState(state) {
  const t = state.totals;
  $('cart-lines').innerHTML = t.items.length
    ? t.items.map((i) => `<p>${i.qty} × ${esc(i.title)} <span class="muted">· ${inr(i.linePaise)}</span></p>`).join('')
    : '<p class="muted">Cart is empty.</p>';

  $('cart-math').innerHTML = t.items.length
    ? `<div class="row"><span>Subtotal</span><span>${inr(t.subtotalPaise)}</span></div>
       ${t.discountPaise ? `<div class="row disc"><span>Discount (${esc(t.couponCode)})</span><span>−${inr(t.discountPaise)}</span></div>` : ''}
       <div class="row"><span>Shipping</span><span>${t.shippingPaise ? inr(t.shippingPaise) : 'FREE'}</span></div>
       <div class="row total"><span>Payable</span><span>${inr(t.totalPaise)}</span></div>`
    : '';

  const pending = state.pendingOrder;
  $('checkout-btn').disabled = !t.items.length || !!pending;
  $('checkout-btn').textContent = pending ? 'Order drafted' : 'Checkout';
  $('checkout-btn').classList.toggle('btn-primary', !pending);
  $('checkout-btn').classList.toggle('btn-ghost', !!pending);

  const payBox = $('pay-box');
  if (pending && pending.status === 'pending') {
    payBox.classList.remove('hidden');
    $('pay-title').textContent = `Order ${pending.orderId} — ${inr(pending.totalPaise)}` +
      (pending.attempts ? ` · attempt ${pending.attempts + 1}` : '') +
      (pending.failureReason ? ` · last failure: ${pending.failureReason}` : '');
  } else {
    payBox.classList.add('hidden');
  }
}

async function refreshState() {
  const { state } = await api(`/api/state?sessionId=${encodeURIComponent(S.sessionId)}`);
  updateState(state);
}

/* ── checkout & pay (the human's gate) ────────────────────────────────── */
async function doCheckout() {
  const resp = await api('/api/checkout', {});
  if (resp.data?.token) S.token = resp.data.token;
  if (resp.state) updateState(resp.state);
  bubble('agent', `${md(resp.message)}<br>${chipFor('checkout', 'user click', resp.status)}`);
  refreshAudit();
}

async function doPay() {
  const simulate = $('force-fail').checked ? 'failure' : null;
  const resp = await api('/api/confirm', { token: S.token, simulate });
  // On a decline the server keeps the SAME order (and token) pending for
  // retry — only burn the client copy when the order reached a final state.
  if (resp.status === 'ok') S.token = null;
  bubble('agent', `${md(resp.message)}<br>${chipFor('confirm_payment', 'user click', resp.status)}`);
  refreshAudit();
  refreshState();
  if (resp.data?.order?.status === 'paid') {
    refreshCatalog();
    const receipt = await api(`/api/receipt?orderId=${encodeURIComponent(resp.data.order.orderId)}`);
    $('receipt-id').textContent = resp.data.order.orderId;
    $('receipt-json').textContent = JSON.stringify(receipt, null, 2);
    $('receipt-dialog').showModal();
  }
}

/* ── catalog ──────────────────────────────────────────────────────────── */
function renderCatalog() {
  $('catalog').innerHTML = S.catalog.products
    .map((p) => {
      const stockCls = p.stock === 0 ? 'out' : p.stock <= 5 ? 'low' : '';
      const stockTxt = p.stock === 0 ? 'Sold out' : p.stock <= 5 ? `Only ${p.stock} left` : `${p.stock} in stock`;
      return `<div class="product">
        <div class="emoji mono">${initials(p.title)}</div>
        <div>
          <h3>${esc(p.title)}</h3>
          <p class="desc">${esc(p.description)}</p>
          <span class="price">${inr(p.price_paise)}</span> · <span class="stock ${stockCls}">${stockTxt}</span>
        </div>
        <button class="add-btn" data-sku="${esc(p.sku)}" data-alias="${esc(p.aliases?.[0] ?? p.sku)}" ${p.stock === 0 ? 'disabled' : ''}>Add</button>
      </div>`;
    })
    .join('');
  $('catalog').querySelectorAll('.add-btn:not([disabled])').forEach((btn) =>
    btn.addEventListener('click', () => sendMessage(`add 1 ${btn.dataset.alias}`))
  );
}

async function refreshCatalog() {
  S.catalog = await api('/catalog.json');
  renderCatalog();
}

/* ── audit trail ──────────────────────────────────────────────────────── */
const STATUS_CLASS = { blocked: 'refused', failed: 'refused', gate_denied: 'refused', recovered: 'warn' };
function passMark(pass) {
  return pass ? '<span style="color:var(--green)">✓</span>' : '<span style="color:var(--red)">✗</span>';
}

function renderAudit(events) {
  const filtered = events.filter((e) => {
    if (S.filter === 'money') return e.action.startsWith('money.') || e.action.startsWith('campaign.');
    if (S.filter === 'refused') return ['blocked', 'failed', 'gate_denied'].includes(e.status);
    return true;
  });
  $('audit').innerHTML = filtered
    .map(
      (e) => `<div class="event ${STATUS_CLASS[e.status] ?? ''}">
        <div class="e-head">
          <span><span class="actor-chip actor-${esc(e.actor)}">${esc(e.actor)}</span> <span class="e-action">${esc(e.action)}</span></span>
          <span>${timeOf(e.ts)}</span>
        </div>
        <p class="e-expl">${esc(e.explanation)}</p>
        ${e.reasoning ? `<p class="e-why">why: ${esc(e.reasoning)}</p>` : ''}
        ${e.bounds?.length ? `<ul class="e-bounds">${e.bounds.map((b) => `<li>${passMark(b.pass)} <b>${esc(b.name)}</b> — ${esc(b.detail)}</li>`).join('')}</ul>` : ''}
        <div class="e-hash">#${e.seq} ${e.hash.slice(0, 12)}… ← prev ${e.prevHash.slice(0, 12)}…</div>
      </div>`
    )
    .join('') || '<p class="muted" style="padding:10px">No events yet — talk to the agent.</p>';
}

async function refreshAudit() {
  const { events, verify } = await api(`/api/audit?sessionId=${encodeURIComponent(S.sessionId)}&limit=150`);
  renderAudit(events);
  const pill = $('chain-status');
  if (verify.valid) {
    pill.className = 'pill pill-ok';
    pill.textContent = `chain intact · ${verify.count} events`;
  } else {
    pill.className = 'pill pill-bad';
    pill.textContent = `chain BROKEN at #${verify.brokenAt}`;
  }
}

/* ── demo controls ────────────────────────────────────────────────────── */
async function demoStock() {
  await api('/api/dev/set-stock', { sku: 'gift-hamper', qty: 0 });
  refreshCatalog();
  refreshAudit();
  bubble('agent', md('Demo: **another buyer just took the last Festive Gift Hamper** (stock → 0). Now try **checkout** to watch the agent handle the out-of-stock failure gracefully.'));
}

async function demoCampaign() {
  const r = await api('/api/campaigns/run', {});
  bubble(
    'agent',
    md(
      r.issuedCount
        ? `Cart-recovery campaign ran: ${r.issuedCount} coupon(s) issued (${r.issued.map((x) => x.code).join(', ')}). Carts idle > ${Math.round(r.idleThresholdMs / 1000)}s were targeted, one issue per session max.`
        : `Campaign ran — no eligible carts (needs a cart idle > ${Math.round(r.idleThresholdMs / 1000)}s, no coupon yet).`
    ) + `<br>${chipFor('campaign.run', 'system', 'ok')}`
  );
  refreshAudit();
  refreshState();
}

async function demoTamper() {
  await api('/api/dev/tamper', {});
  refreshAudit();
  bubble('agent', md('Demo: the newest ledger event was rewritten in place. The **Verify ledger** button (and the header pill) now shows the chain is broken — tampering is detectable by construction.'));
}

async function demoReset() {
  await api('/api/dev/reset', {});
  S.token = null;
  $('chat').innerHTML = '';
  welcome();
  refreshAudit();
  refreshState();
}

/* ── boot ─────────────────────────────────────────────────────────────── */
function welcome() {
  bubble(
    'agent',
    md(
      "Namaste! I'm the **MasalaMart growth agent**\nI can find products, build your cart, apply coupons and draft your order — and every money move I make is **explained, bounded and audited** (watch the right panel).\n\nI can't charge you: payment happens only when **you** press Pay. Try *" +
        'gift under 500*' +
        ' or *"add 2 masala chai".*'
    )
  );
}

function renderSuggestions() {
  const items = ['gift under 500', 'add 2 masala chai', 'what pairs with the coffee?', 'apply WELCOME10', 'apply SAVE30', "what's in my cart?", 'checkout', 'yes, pay now'];
  $('suggestions').innerHTML = items.map((t) => `<button class="suggestion">${esc(t)}</button>`).join('');
  $('suggestions').querySelectorAll('.suggestion').forEach((b) => b.addEventListener('click', () => sendMessage(b.textContent)));
}

async function boot() {
  S.config = await api('/api/config');
  const { limits } = S.config;
  $('config-chips').innerHTML = [
    `<span class="chip"><b>${esc(S.config.provider.label)}</b></span>`,
    `<span class="chip">NLU: <b>${esc(S.config.provider.llm)}</b></span>`,
    `<span class="chip">≤ <b>${inr(limits.maxPerTransactionPaise)}</b>/order</span>`,
    `<span class="chip">≤ <b>${inr(limits.maxSessionSpendPaise)}</b>/session</span>`,
    `<span class="chip">≤ <b>${limits.maxQtyPerSku}</b>/SKU</span>`,
    `<span class="chip">coupons ≤ <b>${limits.couponMaxPercent}%</b> / <b>${inr(limits.couponMaxPaise)}</b></span>`,
  ].join('');
  $('nlu-badge').textContent = `NLU: ${S.config.provider.llm}`;

  await refreshCatalog();
  renderSuggestions();
  welcome();
  await refreshAudit();
  await refreshState();

  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('chat-text').value;
    $('chat-text').value = '';
    sendMessage(text);
  });
  $('checkout-btn').addEventListener('click', doCheckout);
  $('pay-btn').addEventListener('click', doPay);
  $('verify-btn').addEventListener('click', refreshAudit);
  $('demo-stock').addEventListener('click', demoStock);
  $('demo-campaign').addEventListener('click', demoCampaign);
  $('demo-tamper').addEventListener('click', demoTamper);
  $('demo-reset').addEventListener('click', demoReset);
  document.querySelectorAll('.chip-filter').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.chip-filter').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      S.filter = b.dataset.filter;
      refreshAudit();
    })
  );
}

boot().catch((err) => bubble('agent', `Boot failed: ${esc(err.message)} — is the server running?`));

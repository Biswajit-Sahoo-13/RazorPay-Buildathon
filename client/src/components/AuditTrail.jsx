import { ScrollText, FlaskConical, Check, X, ShieldCheck, Link2, UserRound, Bot, Cog } from 'lucide-react';

const STATUS_CLASS = { blocked: 'refused', failed: 'refused', gate_denied: 'refused', recovered: 'warn' };
const ACTOR_ICON = { agent: <Bot />, user: <UserRound />, system: <Cog /> };

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'money', label: 'Money' },
  { id: 'refused', label: 'Refused / failed' },
];

const timeOf = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function EventCard({ e }) {
  return (
    <div className={`event ${STATUS_CLASS[e.status] ?? ''}`}>
      <span className="e-dot" />
      <div className="e-head">
        <span className="e-action">
          {e.action}
          <span className={`e-actor ${e.actor}`}>{ACTOR_ICON[e.actor] ?? null} {e.actor}</span>
        </span>
        <span className="e-time">{timeOf(e.ts)}</span>
      </div>
      <div className="e-card">
        <p className="e-expl">{e.explanation}</p>
        {e.reasoning && <p className="e-why">why: {e.reasoning}</p>}
        {e.bounds?.length > 0 && (
          <ul className="e-bounds">
            {e.bounds.map((b, i) => (
              <li key={i}>
                {b.pass ? <Check className="pass" /> : <X className="fail" />}
                <span><b>{b.name}</b> — {b.detail}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="e-hash">#{e.seq} {e.hash.slice(0, 14)}… ← prev {e.prevHash.slice(0, 14)}…</div>
      </div>
    </div>
  );
}

export default function AuditTrail({ audit, filter, setFilter, onDemo }) {
  const events = (audit.events ?? []).filter((e) => {
    if (filter === 'money') return e.action.startsWith('money.') || e.action.startsWith('campaign.');
    if (filter === 'refused') return ['blocked', 'failed', 'gate_denied'].includes(e.status);
    return true;
  });

  return (
    <section className="panel audit-panel">
      <div className="panel-head">
        <span className="panel-title"><ScrollText /> Audit Trail <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>· this session</span></span>
        <span className={`pill ${audit.verify?.valid ? 'ok' : 'bad'}`}>
          {audit.verify?.valid ? <ShieldCheck /> : <X />}
          {audit.verify?.valid ? `chain intact · ${audit.verify.count}` : `BROKEN at #${audit.verify?.brokenAt}`}
        </span>
      </div>

      <details className="demo-controls">
        <summary><FlaskConical /> Demo controls — judge scenarios</summary>
        <div className="demo-grid">
          <button className="btn btn-ghost btn-sm" onClick={() => onDemo('stock')}>👋 Another buyer takes the hamper</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onDemo('campaign')}>📣 Run cart-recovery campaign</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onDemo('tamper')}>🧨 Tamper with ledger</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onDemo('reset')}>♻️ Reset session</button>
        </div>
      </details>

      <div className="audit-filters">
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip-filter ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="audit-scroll">
        {events.length === 0 ? (
          <div className="audit-empty">
            <Link2 />
            <p>No events yet — talk to the agent.<br />Every money action lands here with its reasoning and bounds.</p>
          </div>
        ) : (
          events.map((e) => <EventCard key={e.id} e={e} />)
        )}
      </div>
    </section>
  );
}

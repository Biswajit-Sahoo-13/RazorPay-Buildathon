import { ShieldCheck, ShieldAlert, Store } from 'lucide-react';
import { inr } from '../api.js';

export default function TopBar({ config, chain, onVerify }) {
  const limits = config?.limits;
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark"><Store size={21} /></div>
        <div>
          <h1>
            MasalaMart <span className="sub">· agentic storefront</span>
          </h1>
          <p className="tagline">Sold to humans and AI agents alike — every money move explainable, bounded, gated.</p>
        </div>
      </div>
      <div className="topbar-right">
        <div className="glass-chips">
          <span className="glass-chip"><span className="dot" /> <b>{config?.provider.label ?? '…'}</b></span>
          <span className="glass-chip">NLU <b>{config?.provider.llm ?? '…'}</b></span>
          {limits && (
            <>
              <span className="glass-chip">≤ <b>{inr(limits.maxPerTransactionPaise)}</b>/order</span>
              <span className="glass-chip">≤ <b>{inr(limits.maxSessionSpendPaise)}</b>/session</span>
              <span className="glass-chip">≤ <b>{limits.maxQtyPerSku}</b>/SKU</span>
              <span className="glass-chip">coupons ≤ <b>{limits.couponMaxPercent}%</b></span>
            </>
          )}
        </div>
        <button className="btn-verify" onClick={onVerify} title="Recompute the hash chain over the audit ledger">
          {chain?.valid ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />}
          {chain?.valid ? `Ledger · ${chain.count}` : 'Chain broken'}
        </button>
      </div>
    </header>
  );
}

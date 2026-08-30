import { Store, ArrowUpRight } from 'lucide-react';
import { inr, initials } from '../api.js';

function Product({ p, onAdd }) {
  const stockCls = p.stock === 0 ? 'out' : p.stock <= 5 ? 'low' : '';
  const stockTxt = p.stock === 0 ? 'Sold out' : p.stock <= 5 ? `Only ${p.stock} left` : `${p.stock} in stock`;
  return (
    <div className="product">
      <div className="tile mono-tile">{initials(p.title)}</div>
      <div>
        <h3>{p.title}</h3>
        <p className="desc">{p.description}</p>
        <div className="meta">
          <span className="price">{inr(p.price_paise)}</span>
          <span className={`stock ${stockCls}`}>{stockTxt}</span>
        </div>
      </div>
      <button className="btn-add" disabled={p.stock === 0} onClick={() => onAdd(p.aliases?.[0] ?? p.sku)}>
        Add
      </button>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="skeleton">
      <div className="tile sk" />
      <div>
        <div className="sk" style={{ height: 11, width: '75%' }} />
        <div className="sk" style={{ height: 9, width: '95%', marginTop: 7 }} />
        <div className="sk" style={{ height: 9, width: '40%', marginTop: 7 }} />
      </div>
    </div>
  );
}

export default function CatalogRail({ catalog, onAdd }) {
  return (
    <section className="panel catalog-panel">
      <div className="panel-head">
        <span className="panel-title"><Store /> Catalog</span>
        <a className="feed-link" href="/catalog.json" target="_blank" rel="noreferrer">
          agent-readable feed <ArrowUpRight />
        </a>
      </div>
      <div className="catalog">
        {!catalog && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} />)}
        {catalog?.products.map((p) => <Product key={p.sku} p={p} onAdd={onAdd} />)}
      </div>
    </section>
  );
}

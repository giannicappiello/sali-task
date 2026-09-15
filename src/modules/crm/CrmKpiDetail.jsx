import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Info, X } from 'lucide-react';
import './crm-kpi-detail.css';
import { queryDetailRows } from './crmDetailQuery';

export function CrmKpiCard({ label, value, note, info, onClick }) {
  const [showInfo, setShowInfo] = useState(false);
  return <article className="kpi-card crm-kpi b2b-kpi-card">
    <button type="button" className="b2b-kpi-open" onClick={() => { setShowInfo(false); onClick(); }} aria-label={`${label}: ${value}. Apri dettaglio`}>
      <span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}<em>Apri dettaglio →</em>
    </button>
    <button type="button" className="b2b-kpi-info" aria-label={`Informazioni: ${label}`} aria-expanded={showInfo} onClick={() => setShowInfo(!showInfo)}><Info size={16}/></button>
    {showInfo && <p className="b2b-kpi-explanation" role="status">{info}</p>}
  </article>;
}

export function CrmDetailTable({ rows, columns, empty = 'Nessun dato disponibile per i filtri selezionati.' }) {
  const [search, setSearch] = useState(''); const [filters, setFilters] = useState({});
  const [sort, setSort] = useState({ key: '', direction: 'asc' }); const [hidden, setHidden] = useState([]);
  const [page, setPage] = useState(0);
  const visible = columns.filter(c => !hidden.includes(c.key));
  const result = useMemo(() => queryDetailRows(rows, columns, search, filters, sort), [rows, columns, search, filters, sort]);
  const pages = Math.max(1, Math.ceil(result.length / 25)); const current = Math.min(page, pages - 1);
  return <>
    <div className="b2b-detail-tools"><label>Cerca nel dettaglio<input type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Cerca in tutte le colonne"/></label>
      <details className="b2b-column-picker"><summary>Colonne visibili</summary><div>{columns.map(c => <label key={c.key}><input type="checkbox" checked={!hidden.includes(c.key)} disabled={visible.length === 1 && !hidden.includes(c.key)} onChange={e => setHidden(e.target.checked ? hidden.filter(k => k !== c.key) : [...hidden, c.key])}/>{c.label}</label>)}</div></details>
      <button type="button" className="secondary-action" onClick={() => { setSearch(''); setFilters({}); setSort({ key: '', direction: 'asc' }); setHidden([]); setPage(0); }}>Azzera filtri</button>
    </div>
    <div className="b2b-detail-table-wrap"><table className="crm-table" data-column-controls="off"><thead><tr>{visible.map(c => <th key={c.key} aria-sort={sort.key === c.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
      <button type="button" className="b2b-sort" onClick={() => { setSort({ key: c.key, direction: sort.key === c.key && sort.direction === 'asc' ? 'desc' : 'asc' }); setPage(0); }}>{c.label}{sort.key === c.key ? sort.direction === 'asc' ? <ArrowUp size={14}/> : <ArrowDown size={14}/> : null}</button>
      <input aria-label={`Filtra ${c.label}`} placeholder="Filtra…" value={filters[c.key] || ''} onChange={e => { setFilters({ ...filters, [c.key]: e.target.value }); setPage(0); }}/>
    </th>)}</tr></thead><tbody>{result.slice(current * 25, current * 25 + 25).map((row, i) => <tr key={row.id || row.key || i}>{visible.map(c => <td key={c.key}>{c.render ? c.render(row) : String(c.value(row) ?? '—')}</td>)}</tr>)}</tbody></table></div>
    {!result.length && <p className="crm-empty">{empty}</p>}
    <div className="b2b-detail-pagination"><span role="status">{result.length} di {rows.length} righe · Pagina {current + 1} di {pages}</span><div><button type="button" className="secondary-action" disabled={!current} onClick={() => setPage(current - 1)}>Precedente</button><button type="button" className="secondary-action" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>Successiva</button></div></div>
  </>;
}

export function CrmKpiDialog({ title, subtitle, onClose, children }) {
  const dialog = useRef(null); const close = useRef(null);
  useEffect(() => {
    const element = dialog.current; const previous = document.activeElement; const overflow = document.body.style.overflow;
    element.showModal(); close.current.focus(); document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = overflow; previous?.focus?.(); };
  }, []);
  return <dialog ref={dialog} className="b2b-kpi-dialog" aria-labelledby="b2b-detail-title" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === dialog.current) onClose(); }}>
    <header><div><h2 id="b2b-detail-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button ref={close} type="button" className="secondary-action" aria-label="Chiudi dettaglio" onClick={onClose}><X size={22}/></button></header>
    <div className="b2b-dialog-body">{children}</div><footer><button type="button" className="secondary-action" onClick={onClose}>Chiudi</button></footer>
  </dialog>;
}

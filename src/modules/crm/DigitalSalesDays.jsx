import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useDatasetTableControls, usePaginatedDataset, useResetPageCallback } from '../../components/useDatasetTableControls';
import { digitalConnectionsService } from '../integrations/services/digitalConnectionsService';
import { formatDate } from './crmConfig';
import { countsInSales, salesDays } from './digitalSalesDayModel.js';

const amount = (value, currency = 'EUR') => value == null ? 'Dato non disponibile' : new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(Number(value));
const columns = [{ value: (d) => formatDate(d.date) }, { value: (d) => d.marketplace }, { value: (d) => amount(d.amount, d.currency) }, { value: (d) => d.count }];
const statuses = { completed: 'Completato', processing: 'In lavorazione', cancelled: 'Annullato', canceled: 'Annullato', failed: 'Fallito', pending: 'In attesa', 'on-hold': 'In sospeso', refunded: 'Rimborsato', shipped: 'Spedito', unshipped: 'Da spedire', partially_shipped: 'Spedito parzialmente' };
const status = (value) => statuses[String(value || '').toLowerCase()] || value || 'Non disponibile';

function OrderDetail({ selected, onClose }) {
  const dialogRef = useRef(null);
  const [detail, setDetail] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const dialog = dialogRef.current, previous = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    digitalConnectionsService.orderDetail(selected.id).then((r) => { if (active) { setDetail(r.order); setError(''); } }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [selected.id, retry]);
  return createPortal(<dialog ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="digital-order-title" className="crm-digital-order-dialog" onCancel={(e) => { e.preventDefault(); onClose(); }}>
    <header><div><small>Dettaglio ordine</small><h2 id="digital-order-title">Ordine {selected.external_id}</h2></div><button type="button" aria-label="Chiudi dettaglio ordine" onClick={onClose}><X size={22} /></button></header>
    {error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => { setError(''); setRetry((n) => n + 1); }}>Riprova</button></div> : null}
    {!detail && !error ? <p role="status">Caricamento cliente e prodotti…</p> : null}
    {detail ? <><dl className="crm-order-summary"><div><dt>Cliente</dt><dd>{detail.customerName || detail.customerUnavailable}</dd></div><div><dt>Data</dt><dd>{formatDate(detail.date)}</dd></div><div><dt>Stato</dt><dd>{status(detail.status)}</dd></div><div><dt>Marketplace</dt><dd>{detail.marketplace || 'Sito'}</dd></div><div><dt>Importo netto</dt><dd>{amount(detail.amount, detail.currency)}</dd></div><div><dt>Totale ordine IVA inclusa</dt><dd>{amount(detail.total, detail.currency)}</dd></div>{detail.refunds != null && Number(detail.refunds) !== 0 ? <div><dt>Rimborsi</dt><dd>{amount(detail.refunds, detail.currency)}</dd></div> : null}</dl>
      {detail.warning ? <p role="status" className="crm-message">{detail.warning}</p> : null}
      <h3>Prodotti acquistati</h3><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Prodotto</th><th>Codice / ASIN</th><th>Quantità</th><th>Prezzo unitario</th><th>Sconto</th><th>Importo riga</th></tr></thead><tbody>{detail.lines.map((l) => <tr key={l.id}><td>{l.name}</td><td>{[l.sku, l.asin].filter(Boolean).join(' / ') || '—'}</td><td>{l.quantity ?? '—'}</td><td>{amount(l.unitPrice, detail.currency)}</td><td>{amount(l.discount, detail.currency)}</td><td>{amount(l.amount, detail.currency)}</td></tr>)}</tbody></table></div>{!detail.lines.length ? <p>Nessuna riga prodotto disponibile.</p> : null}<p className="crm-order-note">L’importo del riepilogo è netto IVA e tiene conto dei rimborsi disponibili. Il totale ordine include l’IVA; le spese di spedizione sono riportate nelle righe disponibili.</p></> : null}
    <footer><button type="button" className="secondary-action crm-secondary" onClick={onClose}>Chiudi</button></footer>
  </dialog>, document.body);
}

export default function DigitalSalesDays({ orders, loading }) {
  const [expanded, setExpanded] = useState(new Set()), [selected, setSelected] = useState(null), [page, setPage] = useState(0);
  const reset = useResetPageCallback(setPage);
  const [tableRef, query] = useDatasetTableControls({ onQueryChange: reset });
  const days = useMemo(() => salesDays(orders), [orders]);
  const { pageRows, total } = usePaginatedDataset(days, columns, query, page, 30);
  return <section className="panel crm-panel"><h3>Metriche disponibili</h3><p>Apri un giorno per vedere gli ordini; seleziona un ordine per cliente e prodotti acquistati. L’importo è netto IVA e tiene conto dei rimborsi disponibili.</p>
    {loading ? <p role="status">Caricamento vendite…</p> : null}
    <div className="crm-table-wrap"><table ref={tableRef} data-column-controls-mode="dataset" className="crm-table crm-sales-days"><thead><tr><th>Data</th><th>Marketplace</th><th>Importo</th><th>Ordini</th></tr></thead><tbody>{pageRows.map((day) => {
      const open = expanded.has(day.id);
      const toggle = () => setExpanded((old) => { const next = new Set(old); if (next.has(day.id)) next.delete(day.id); else next.add(day.id); return next; });
      return <Fragment key={day.id}><tr className="crm-sales-day" onClick={toggle}><td><button type="button" aria-label={`${open ? 'Chiudi' : 'Apri'} ordini del ${formatDate(day.date)}`} aria-expanded={open} aria-controls={`orders-${day.id}`} onClick={(e) => { e.stopPropagation(); toggle(); }}>{open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}{formatDate(day.date)}</button></td><td>{day.marketplace}</td><td>{amount(day.amount, day.currency)}</td><td>{day.count}{day.orders.length !== day.count ? <small> · {day.orders.length - day.count} esclusi dal totale</small> : null}</td></tr>
        {open ? <tr><td colSpan={4}><div id={`orders-${day.id}`} className="crm-day-orders"><table className="crm-table"><thead><tr><th>Ordine</th><th>Cognome e Nome</th><th>Stato</th><th>Importo</th></tr></thead><tbody>{day.orders.map((o) => <tr key={o.id} className="crm-order-link-row" onClick={() => setSelected(o)}><td><button type="button" onClick={(e) => { e.stopPropagation(); setSelected(o); }} aria-label={`Apri dettaglio ordine ${o.external_id}`}>{o.external_id}</button></td><td>{o.raw_summary?.customer_name || 'Nominativo non disponibile'}</td><td>{status(o.stato)}{!countsInSales(o) ? <small> · Escluso dal totale giornaliero</small> : null}</td><td>{amount(o.net_revenue, o.currency)}</td></tr>)}</tbody></table></div></td></tr> : null}</Fragment>;
    })}</tbody></table></div>
    {!loading && !days.length ? <p className="crm-empty">Nessun ordine importato nel periodo selezionato.</p> : null}
    <div className="crm-pagination"><button type="button" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>Precedente</button><span>Pagina {page + 1} · {total} giorni</span><button type="button" disabled={(page + 1) * 30 >= total} onClick={() => setPage((n) => n + 1)}>Successiva</button></div>
    {selected ? <OrderDetail key={selected.id} selected={selected} onClose={() => setSelected(null)} /> : null}
  </section>;
}

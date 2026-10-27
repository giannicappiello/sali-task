import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useDatasetTableControls, usePaginatedDataset, useResetPageCallback } from '../../components/useDatasetTableControls';
import { digitalConnectionsService } from '../integrations/services/digitalConnectionsService';
import { formatDate } from './crmConfig';
import CrmCustomerLink from './CrmCustomerLink';
import AmazonCoxStatus from './AmazonCoxStatus';
import { orderDisplayAmount } from '../../../shared/amazonOrderAmounts.js';
import { marketplaceLabel } from './marketplaceLabel.js';
import { countsInSales, salesDays } from './digitalSalesDayModel.js';
import { formatMexalOrderReference } from '../../../shared/wooMexalReference.js';

const amount = (value, currency = 'EUR') => value == null ? 'Dato non disponibile' : new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(Number(value));
const baseColumns = [{ value: (d) => formatDate(d.date) }, { value: (d) => d.marketplace }, { value: (d) => amount(d.amount, d.currency) }, { value: (d) => d.count }];
const amazonColumns = [baseColumns[0],baseColumns[1],{value:day=>amount(day.fulfilledAmount,day.currency)},{value:day=>day.fulfilledCount},{value:day=>day.waitingCount}];
function OrderAmount({order}) {
  const display = orderDisplayAmount(order);
  return <>{amount(display.amount,order.currency)}{display.note ? <small> · {display.note}</small> : null}</>;
}

const statuses = { completed: 'Completato', processing: 'In lavorazione', cancelled: 'Annullato', canceled: 'Annullato', failed: 'Fallito', pending: 'In attesa', 'on-hold': 'In sospeso', refunded: 'Rimborsato', shipped: 'Spedito', unshipped: 'Da spedire', pending_availability: 'In attesa di disponibilità', unfulfillable: 'Non evadibile', partially_shipped: 'Spedito parzialmente' };
const status = (value) => statuses[String(value || '').toLowerCase()] || value || 'Non disponibile';
function MexalSyncInfo({ value, compact = false }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  if (!value) return null;
  const stale = !Number.isFinite(Date.parse(value.checkedAt)) || now - Date.parse(value.checkedAt) > 90 * 60000;
  const catalogStale = !value.catalogAt || now - Date.parse(value.catalogAt) > 90 * 60000;
  const label = value.status === 'blocked' ? `Invio Mexal bloccato: ${value.message}` : stale ? 'Verifica connettore non recente' : 'Invio Mexal verificato';
  if (compact) return value.status === 'blocked' || stale ? <small style={{ display: 'block' }} role="status">{label}</small> : null;
  const date = (v) => v ? new Date(v).toLocaleString('it-IT') : 'non disponibile';
  const comparison=value.amountComparison;
  return <div className="crm-message" role="status"><p>{label}</p><p>Ultima verifica: {date(value.checkedAt)}. Catalogo aggiornato: {date(value.catalogAt)}.</p>{comparison && (comparison.totalDifferenceCents!==0 || comparison.taxDifferenceCents!==0) ? <p>Totale sito: {amount(comparison.sourceTotalCents/100)} · Totale OC: {amount(comparison.mexalTotalCents/100)}. Scostamento accettato nei centesimi: euro e prima cifra decimale coincidono.</p> : null}{stale || catalogStale ? <p>Controllare che il computer del connettore sia acceso e la sincronizzazione sia in esecuzione.</p> : null}</div>;
}

function OrderDetail({ selected, onClose, onReference }) {
  const dialogRef = useRef(null);
  const [detail, setDetail] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const dialog = dialogRef.current, previous = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    digitalConnectionsService.orderDetail(selected.id).then((r) => { if (active) { setDetail(r.order); setError(''); onReference(selected.id, r.order.mexalOc, r.order.mexalSync); } }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [selected.id, retry, onReference]);
  return createPortal(<dialog ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="digital-order-title" className="crm-digital-order-dialog" onCancel={(e) => { e.preventDefault(); onClose(); }}>
    <header><div><small>Dettaglio ordine</small><h2 id="digital-order-title">Ordine {selected.external_id}</h2></div><button type="button" aria-label="Chiudi dettaglio ordine" onClick={onClose}><X size={22} /></button></header>
    {error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => { setError(''); setRetry((n) => n + 1); }}>Riprova</button></div> : null}
    {!detail && !error ? <p role="status">Caricamento cliente e prodotti…</p> : null}
    {detail ? <><dl className="crm-order-summary"><div><dt>Cliente</dt><dd><CrmCustomerLink crmType="online" accountId={selected.account_id} name={selected.customerName || detail.customerName}>{selected.customerName || detail.customerName || detail.customerUnavailable}</CrmCustomerLink></dd></div><div><dt>Data</dt><dd>{formatDate(detail.date)}</dd></div><div><dt>Stato</dt><dd>{status(detail.status)}</dd></div><div><dt>Marketplace</dt><dd>{marketplaceLabel(detail.marketplace, 'Sito')}</dd></div><div><dt>Importo netto</dt><dd>{amount(detail.amount, detail.currency)}</dd></div><div><dt>Totale ordine IVA inclusa</dt><dd>{amount(detail.total, detail.currency)}</dd></div>{detail.amount == null && (detail.pricePreview || selected.pricePreview) ? <div><dt>Importo prodotti (provvisorio)</dt><dd>{amount((detail.pricePreview || selected.pricePreview).amount,detail.currency)}</dd></div> : null}{detail.refunds != null && Number(detail.refunds) !== 0 ? <div><dt>Rimborsi</dt><dd>{amount(detail.refunds, detail.currency)}</dd></div> : null}</dl>
      {selected.raw_summary?.provider === 'amazon_sp_api' ? <p><strong>Corrispettivo Mexal: </strong><AmazonCoxStatus status={detail.coxStatus} reference={detail.coxReference} error={detail.coxError}/></p> : null}
      {formatMexalOrderReference(detail.mexalOc) ? <p><strong>OC Mexal:</strong> {formatMexalOrderReference(detail.mexalOc)}</p> : null}
      <MexalSyncInfo value={detail.mexalSync} />
      {detail.warning ? <p role="status" className="crm-message">{detail.warning}</p> : null}
      <h3>Prodotti acquistati</h3><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Prodotto</th><th>Codice / ASIN</th><th>Quantità</th><th>Prezzo unitario</th><th>Sconto</th><th>Importo riga</th></tr></thead><tbody>{detail.lines.map((l) => <tr key={l.id}><td>{l.name}</td><td>{[l.sku, l.asin].filter(Boolean).join(' / ') || '—'}</td><td>{l.quantity ?? '—'}</td><td>{amount(l.unitPrice, detail.currency)}</td><td>{amount(l.discount, detail.currency)}</td><td>{amount(l.amount ?? (l.unitPrice != null && l.quantity != null ? Number(l.unitPrice)*Number(l.quantity) : null), detail.currency)}{l.amount == null && l.unitPrice != null && l.quantity != null ? <small> · Provvisorio</small> : null}</td></tr>)}</tbody></table></div>{!detail.lines.length ? <p>Nessuna riga prodotto disponibile.</p> : null}<p className="crm-order-note">L’importo del riepilogo è netto IVA e tiene conto dei rimborsi disponibili. Il totale ordine include l’IVA; le spese di spedizione sono riportate nelle righe disponibili. Gli importi provvisori derivati dai prezzi dei prodotti non confermano sconti, IVA e spedizione.</p></> : null}
    <footer><button type="button" className="secondary-action crm-secondary" onClick={onClose}>Chiudi</button></footer>
  </dialog>, document.body);
}

export default function DigitalSalesDays({ orders, loading, splitFulfillment = false, includeWaitingInTotals = false, showAvailableWaitingAmounts = false, title = "Metriche disponibili", collapsible = false, showCox = splitFulfillment }) {
  const tableId = useId();
  const [references, setReferences] = useState({});
  const [syncStatuses, setSyncStatuses] = useState({});
  const rememberReference = useCallback((id, value, syncStatus) => { const reference = formatMexalOrderReference(value); if (reference) setReferences(previous => previous[id] === reference ? previous : { ...previous, [id]: reference }); if(syncStatus)setSyncStatuses(previous=>({...previous,[id]:syncStatus})); }, []);
  const [expanded, setExpanded] = useState(new Set()), [selected, setSelected] = useState(null), [page, setPage] = useState(0);
  const reset = useResetPageCallback(setPage);
  const [tableRef, query] = useDatasetTableControls({ onQueryChange: reset });
  const days = useMemo(() => salesDays(orders,includeWaitingInTotals,showAvailableWaitingAmounts), [orders,includeWaitingInTotals,showAvailableWaitingAmounts]);
  const { pageRows, total } = usePaginatedDataset(days, splitFulfillment ? amazonColumns : baseColumns, query, page, 30);
  const content = <><p className="crm-order-note">{title === "Ordini evasi" ? "Data di evasione per Amazon; data ordine per il sito." : title === "Ordini da evadere" ? "Raggruppati per data di acquisto." : null}</p><p>Apri un giorno per vedere gli ordini; seleziona un ordine per cliente e prodotti acquistati. {showAvailableWaitingAmounts ? 'Somma degli importi disponibili negli ordini selezionati. I prezzi dei prodotti sono provvisori; i totali IVA inclusa sono indicati separatamente. Non si presume un totale netto assente.' : splitFulfillment ? 'Importo netto degli ordini evasi. Gli ordini in attesa includono quelli da spedire e spediti parzialmente; i prezzi dei soli prodotti sono indicati come provvisori, senza presumere IVA, spedizioni o sconti mancanti.' : includeWaitingInTotals ? 'Importi netti noti degli ordini selezionati, evasi e da evadere. Gli importi mancanti sono segnalati separatamente.' : 'L’importo è netto IVA e tiene conto dei rimborsi disponibili.'}</p>
    {loading ? <p role="status">Caricamento vendite…</p> : null}
    <div className="crm-table-wrap"><table ref={tableRef} data-column-controls-mode="dataset" className="crm-table crm-sales-days"><thead><tr><th>Data</th><th>Marketplace</th><th>{showAvailableWaitingAmounts ? 'Valore disponibile' : splitFulfillment ? 'Importo netto evasi' : 'Importo'}</th>{splitFulfillment ? <><th>Ordini evasi</th><th>Ordini in attesa</th></> : <th>Ordini</th>}</tr></thead><tbody>{pageRows.map((day) => {
      const open = expanded.has(day.id);
      const toggle = () => setExpanded((old) => { const next = new Set(old); if (next.has(day.id)) next.delete(day.id); else next.add(day.id); return next; });
      return <Fragment key={day.id}><tr className="crm-sales-day" onClick={toggle}><td><button type="button" aria-label={`${open ? 'Chiudi' : 'Apri'} ordini del ${formatDate(day.date)}`} aria-expanded={open} aria-controls={`orders-${tableId}-${day.id}`} onClick={(e) => { e.stopPropagation(); toggle(); }}>{open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}{formatDate(day.date)}</button></td><td>{day.marketplace}</td><td>{amount(splitFulfillment ? day.fulfilledAmount : day.amount, day.currency)}{!splitFulfillment && includeWaitingInTotals && day.missingAmountCount>0 ? <small> · {day.missingAmountCount} importi non disponibili</small> : null}{day.availableEstimated>0 ? <small> · {day.availableEstimated} importi provvisori</small> : null}{day.availableGross>0 ? <small> · {day.availableGross} totali IVA inclusa</small> : null}{splitFulfillment && day.fulfilledMissing > 0 ? <small> · {day.fulfilledMissing} importi netti non disponibili</small> : null}</td>{splitFulfillment ? <><td>{day.fulfilledCount}</td><td>{day.waitingCount}{day.orders.length > day.fulfilledCount + day.waitingCount ? <small> · {day.orders.length-day.fulfilledCount-day.waitingCount} annullati o altri stati</small> : null}</td></> : <td>{day.count}{day.orders.length !== day.count ? <small> · {day.orders.length - day.count} esclusi dal totale</small> : null}</td>}</tr>
        {open ? <tr><td colSpan={splitFulfillment ? 5 : 4}><div id={`orders-${tableId}-${day.id}`} className="crm-day-orders"><table className="crm-table"><thead><tr><th>Ordine</th><th>Cognome e Nome</th><th>Stato</th><th>Importo</th>{showCox ? <th>COX Mexal</th> : null}</tr></thead><tbody>{day.orders.map((o) => <tr key={o.id} className="crm-order-link-row" onClick={() => setSelected(o)}><td><button type="button" onClick={(e) => { e.stopPropagation(); setSelected(o); }} aria-label={`Apri dettaglio ordine ${o.external_id}`}>{o.external_id}</button>{formatMexalOrderReference(references[o.id] || o.raw_summary?.mexal_oc) ? <small style={{ display: 'block' }}>OC Mexal: {formatMexalOrderReference(references[o.id] || o.raw_summary?.mexal_oc)}</small> : null}<MexalSyncInfo compact value={syncStatuses[o.id] || o.raw_summary?.mexal_sync} /></td><td onClick={(event) => event.stopPropagation()}><CrmCustomerLink crmType="online" accountId={o.account_id} name={o.customerName || o.raw_summary?.customer_name}>{o.customerName || o.raw_summary?.customer_name || 'Nominativo non disponibile'}</CrmCustomerLink></td><td>{status(o.stato)}{!countsInSales(o) && !includeWaitingInTotals ? <small> · Escluso dal totale giornaliero</small> : null}</td><td><OrderAmount order={o}/></td>{showCox ? <td><AmazonCoxStatus status={o.cox_status} reference={o.cox_reference} error={o.cox_error}/></td> : null}</tr>)}</tbody></table></div></td></tr> : null}</Fragment>;
    })}</tbody></table></div>
    {!loading && !days.length ? <p className="crm-empty">Nessun ordine importato nel periodo selezionato.</p> : null}
    <div className="crm-pagination"><button type="button" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>Precedente</button><span>Pagina {page + 1} · {total} giorni</span><button type="button" disabled={(page + 1) * 30 >= total} onClick={() => setPage((n) => n + 1)}>Successiva</button></div>
    {selected ? <OrderDetail key={selected.id} selected={selected} onReference={rememberReference} onClose={() => setSelected(null)} /> : null}
  </>;
  return collapsible ? <details className="panel crm-panel crm-catalog-disclosure" open><summary>{title} · {orders.length}</summary>{content}</details> : <section className="panel crm-panel"><h3>{title}</h3>{content}</section>;
}

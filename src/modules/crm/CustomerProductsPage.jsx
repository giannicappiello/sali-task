import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import CrmPeriodFilter, { useCrmPeriod } from './CrmPeriodFilter';
import { CrmPageHeader } from './CrmWorkspaceUI';
import { formatDate, formatMoney } from './crmConfig';
import { CUSTOMER_PRODUCT_CONTEXTS, customerProductAccountPath, CUSTOMER_PRODUCT_SCREENS, groupCustomerProducts, inProductPeriod, loadProductCustomers, productAmount, productDocumentLabel, purchaseDates } from './customerProducts';
import { useCustomerProductData } from './useCustomerProductData';
import './customer-products.css';

const quantity = value => Number(value || 0).toLocaleString('it-IT', { maximumFractionDigits: 4 });
const money = value => value == null ? 'Non disponibile' : formatMoney(value);

function ProductHistoryDialog({ product, rows, kind, period, allHistory, onHistoryChange, onClose }) {
  const dialog = useRef(null); const closeButton = useRef(null);
  const [documentId, setDocumentId] = useState(null);
  useEffect(() => {
    const element = dialog.current; const previousFocus = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    element.showModal(); closeButton.current?.focus(); document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = oldOverflow; previousFocus?.focus?.(); };
  }, []);
  const history = product.history.filter(row => inProductPeriod(row, period.from, period.to, allHistory));
  const firstDate = purchaseDates(product.history)[0];
  const documentRows = documentId ? rows.filter(row => row.document_id === documentId) : [];
  const displayed = documentId ? documentRows : history;
  const amount = productAmount(displayed);
  return <dialog ref={dialog} className="crm-product-dialog" aria-labelledby="crm-product-dialog-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className="crm-product-dialog-inner">
      <header><div><h2 id="crm-product-dialog-title">{documentId ? `Documento ${documentRows[0]?.document_number || ''}` : product.description}</h2><p>{product.code} · {kind === 'ordered' ? 'Storico ordini' : 'Storico documenti di vendita'}</p></div><button ref={closeButton} type="button" className="secondary-action" aria-label="Chiudi dettaglio prodotto" onClick={onClose}><X size={20} /></button></header>
      {documentId ? <button type="button" className="secondary-action" onClick={() => setDocumentId(null)}>← Torna allo storico del prodotto</button> : <label><input type="checkbox" checked={allHistory} onChange={event => onHistoryChange(event.target.checked)} /> Tutto lo storico</label>}
      <p>{documentId ? 'Tutte le righe prodotto visibili del documento selezionato.' : allHistory ? 'Tutti i documenti disponibili, senza filtro di data.' : `Documenti dal ${formatDate(period.from)} al ${formatDate(period.to)}.`} Importi netti IVA esclusa.</p>
      <div className="crm-product-dialog-scroll"><table className="crm-table crm-product-history"><thead><tr>
        <th>Documento / data</th>{documentId && <th>Prodotto</th>}<th>Quantità / UM</th><th>Prezzo unitario</th><th>Sconto</th><th>Importo netto</th><th>Stato / movimento</th>{kind === 'ordered' && <th>Residuo</th>}
      </tr></thead><tbody>{displayed.map(line => <tr key={line.line_id}>
        <td>{documentId ? <strong>{line.document_number}</strong> : <button type="button" className="crm-product-text-button" onClick={() => setDocumentId(line.document_id)}>{line.document_number}</button>}<small>{formatDate(line.document_date)} · {line.document_type}</small></td>
        {documentId && <td>{line.description}<small>{line.product_code}</small></td>}
        <td>{quantity(line.quantity)}<small>{line.unit || 'UM non disponibile'}</small></td><td>{money(line.unit_price)}</td><td>{line.discount || '—'}</td><td>{money(line.net_amount)}</td>
        <td>{line.document_status}<small>{documentId ? (line.is_credit ? 'Storno / nota di credito' : line.excluded_from_totals ? 'Escluso dai totali' : '') : productDocumentLabel(line, firstDate)}</small></td>
        {kind === 'ordered' && <td>{line.remaining_quantity == null ? 'Non disponibile' : quantity(line.remaining_quantity)}</td>}
      </tr>)}</tbody></table></div>
      <footer><span>{displayed.length} righe · {new Set(displayed.map(row => row.document_id)).size} documenti · {formatMoney(amount.value)}{amount.unknown ? ' (parziale: importi mancanti)' : ''}</span><button type="button" className="secondary-action" onClick={onClose}>Chiudi</button></footer>
      {kind === 'ordered' && <small>Il residuo non viene dedotto dalla disponibilità o dai sospesi: compare solo se presente nella fonte. Gli ordini annullati sono esclusi dai totali.</small>}
    </div>
  </dialog>;
}

export default function CustomerProductsPage({ kind }) {
  const period = useCrmPeriod(); const [params, setParams] = useSearchParams();
  const crmType = CUSTOMER_PRODUCT_CONTEXTS.includes(params.get('crmType')) ? params.get('crmType') : '';
  const customerKey = params.get('customer') || ''; const search = params.get('productSearch') || '';
  const allHistory = params.get('productHistory') === 'all'; const selectedCode = params.get('product') || '';
  const [customers, setCustomers] = useState([]); const [customerSearch, setCustomerSearch] = useState(''); const [customerError, setCustomerError] = useState('');
  const { rows, loading, error } = useCustomerProductData(customerKey, kind, crmType);
  useEffect(() => {
    const controller = new AbortController();
    loadProductCustomers(supabase, controller.signal, crmType).then(data => { if (!controller.signal.aborted) { setCustomers(data); setCustomerError(''); } })
      .catch(error => { if (!controller.signal.aborted) setCustomerError(error.message || 'Elenco clienti non disponibile'); });
    return () => controller.abort();
  }, [crmType]);
  const products = useMemo(() => groupCustomerProducts(rows, { from: period.from, to: period.to, allHistory }), [rows, period.from, period.to, allHistory]);
  const visible = products.filter(product => `${product.code} ${product.description}`.toLocaleLowerCase('it-IT').includes(search.trim().toLocaleLowerCase('it-IT')));
  const selectedProduct = products.find(product => product.code === selectedCode);
  const contextCustomers = customers.filter(customer => !crmType || customer.crmType === crmType);
  const selectedCustomer = contextCustomers.find(customer => customer.key === customerKey);
  const config = CUSTOMER_PRODUCT_SCREENS[kind];
  const accountPath = customerProductAccountPath(selectedCustomer?.crmType || crmType, customerKey);
  const update = (key, value) => setParams(current => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value); else next.delete(key);
    if (key === 'crmType') { next.delete('customer'); next.delete('product'); next.delete('productSearch'); }
    if (key === 'customer') { next.delete('product'); next.delete('productSearch'); }
    return next;
  }, { replace: true });
  const name = selectedCustomer?.name || rows[0]?.customer_name || (customerKey ? 'Cliente selezionato' : 'Seleziona un cliente');
  return <div className="crm-page crm-products-page">
    <CrmPageHeader title={config.title} eyebrow="Scheda commerciale cliente" description={name} actions={<CrmPeriodFilter period={period} compact />} />
    <div className="crm-filters"><label>Contesto CRM<select aria-label="Contesto CRM prodotti" value={crmType} onChange={event => update('crmType', event.target.value)}><option value="">Tutti i contesti CRM</option><option value="conto_terzi">PRIVATE</option><option value="b2b">DIRECT · BtoB</option><option value="online">DIRECT · BtoC</option></select></label><label><Search size={16} /><input aria-label="Cerca cliente per prodotti" value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} placeholder="Cerca cliente o codice" /></label>
      <label>Cliente<select aria-label="Cliente prodotti" value={customerKey} onChange={event => update('customer', event.target.value)}><option value="">Seleziona cliente</option>
        {customerKey && !selectedCustomer && <option value={customerKey}>{name}</option>}
        {contextCustomers.filter(customer => customer.key === customerKey || `${customer.name} ${customer.code}`.toLocaleLowerCase('it-IT').includes(customerSearch.toLocaleLowerCase('it-IT'))).map(customer => <option key={customer.key} value={customer.key}>{customer.name} · {customer.code}</option>)}
      </select></label></div>
    {accountPath && <Link to={period.withPeriod(accountPath, { product: null })} className="crm-customer-link">← Scheda cliente</Link>}
    <div className="crm-filters"><label><Search size={16} /><input aria-label="Cerca prodotto" placeholder="Cerca codice o nome prodotto" value={search} onChange={event => update('productSearch', event.target.value)} /></label><label><input type="checkbox" checked={allHistory} onChange={event => update('productHistory', event.target.checked ? 'all' : '')} />Tutto lo storico</label></div>
    <p className="crm-product-note">{kind === 'ordered' ? 'Righe degli ordini canonici, senza sommare nuovamente i documenti figli.' : 'Righe dei documenti di vendita sincronizzati; storni e note di credito disponibili sono conteggiati con segno negativo.'} Importi netti IVA esclusa. Quantità separate per unità di misura; i dati mancanti non vengono ricostruiti.</p>
    {(error || customerError) && <div className="crm-message error" role="alert">{error || customerError}</div>}
    {loading ? <div role="status">Caricamento prodotti…</div> : !error && <><p>{visible.length} prodotti</p><div className="crm-table-wrap"><table className="crm-table crm-customer-products-table"><thead><tr><th>Prodotto</th><th>Quantità / UM</th><th>Importo netto</th><th>Documenti / riordini</th><th>Frequenza / prossimo riordino</th><th>Quota / variazione</th></tr></thead>
      <tbody>{visible.map(product => <tr key={product.code}>
        <td><button type="button" className="crm-product-text-button" onClick={() => update('product', product.code)}>{product.description}</button><small>{product.code}</small></td>
        <td>{product.quantities.map(item => <small key={item.unit}>{quantity(item.quantity)} {item.unit}</small>)}</td>
        <td>{formatMoney(product.amount.value)}{product.amount.unknown > 0 && <small>Parziale · {product.amount.unknown} importi mancanti</small>}</td>
        <td>{product.documents} documenti<small>{product.reorders} giornate di riordino</small></td>
        <td>{product.frequency == null ? 'Storico insufficiente' : `${quantity(product.frequency)} giorni`}<small>{product.nextDate ? `Stima: ${formatDate(product.nextDate)}` : 'Nessuna data stimata'}</small></td>
        <td>{product.share == null ? '—' : `${quantity(product.share)}% del totale`}<small>{allHistory ? 'Confronto non applicabile' : product.variation == null ? 'Confronto non disponibile' : `${product.variation > 0 ? '+' : ''}${quantity(product.variation)}% sul periodo precedente`}</small></td>
      </tr>)}</tbody></table>{!visible.length && <div className="crm-empty">{customerKey ? 'Nessun prodotto disponibile con questi filtri.' : 'Seleziona un cliente per consultare i prodotti.'}</div>}</div></>}
    {selectedProduct && <ProductHistoryDialog key={selectedProduct.code + kind} product={selectedProduct} rows={rows} kind={kind} period={period} allHistory={allHistory} onHistoryChange={checked => update('productHistory', checked ? 'all' : '')} onClose={() => update('product', '')} />}
  </div>;
}

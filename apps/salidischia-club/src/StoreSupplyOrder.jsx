import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Send, Trash2 } from 'lucide-react';
import { money, date } from './client';
import { useSupplyOrderApi } from './usePortalApi';
import useAsync from './useAsync';
import { useAction } from './useAction';
import { Alert, Loading, Modal } from './ui';
import './supply-order.css';

function ProductSearch({ rows, onAdd }) {
  const [input, setInput] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(0);
  const { data, error, loading } = useAsync('club_catalog_products', { search_text: search, category_id: null, page_offset: page * 24 });
  return <section className="panel"><h2>Aggiungi prodotti</h2><form className="search-form" onSubmit={e => { e.preventDefault();setSearch(input.trim());setPage(0); }}><input aria-label="Cerca prodotti per ordine PROGRE" value={input} onChange={e => setInput(e.target.value)} maxLength={200} placeholder="Nome o codice IT" /><button className="button">Cerca</button></form><Alert error={error} />{loading ? <Loading /> : <div className="supply-search-results">{(data?.rows || []).map(product => <button className="button" type="button" key={product.id} disabled={rows.some(p => p.product_id === product.id) || !product.code?.toUpperCase().startsWith('IT')} onClick={() => onAdd({ product_id: product.id, code: product.code, name: product.name, quantity: 1, requested_quantity: 0 })}><span>{product.name}<small>{product.code}</small></span><Plus size={18} /></button>)}</div>}{(page > 0 || data?.total > 24) && <div className="pagination"><button className="button" type="button" disabled={!page || loading} onClick={() => setPage(p => p - 1)}>Precedenti</button><button className="button" type="button" disabled={loading || (page + 1) * 24 >= data?.total} onClick={() => setPage(p => p + 1)}>Successivi</button></div>}</section>;
}
function Totals({ quote }) {
  return <div className="supply-totals"><p><span>Imponibile, trasporto incluso</span><strong>{money(quote.totals.totale_imponibile)}</strong></p>{quote.totals.shipping_net > 0 && <p><span>di cui trasporto</span><strong>{money(quote.totals.shipping_net)}</strong></p>}<p><span>IVA</span><strong>{money(quote.totals.totale_iva)}</strong></p><p className="purchase-total"><span>Totale ordine a PROGRE'</span><strong>{money(quote.totals.totale_documento)}</strong></p></div>;
}
export default function StoreSupplyOrder() {
  const api = useSupplyOrderApi(), action = useAction();
  const [rows, setRows] = useState([]), [quote, setQuote] = useState(null), [note, setNote] = useState('');
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false), [uncertain, setUncertain] = useState(false), [sent, setSent] = useState(null);
  const key = useRef(crypto.randomUUID()), generation = useRef(0), demand = useRef(new Map());
  const history = useAsync('club_supply_history', {}, loaded);
  const load = useCallback(async () => {
    const current = ++generation.current;setLoading(true);setLoadError('');
    try {
      const data = await api({ mode: 'load' });
      if (generation.current !== current) return;
      demand.current = new Map(data.pending.map(p => [p.product_id, p.quantity]));setRows(data.pending.map(p => ({ ...p, requested_quantity: p.quantity })));setQuote(data.quote);setLoadError(data.quote_error || '');setLoaded(true);
    } catch (error) { if (generation.current === current) setLoadError(error.message); }
    finally { if (generation.current === current) setLoading(false); }
  }, [api]);
  useEffect(() => { const ref = generation;const timer = setTimeout(() => void load(), 0);return () => { clearTimeout(timer);ref.current++; }; }, [load]);
  const items = () => rows.map(row => ({ product_id: row.product_id, quantity: Number(row.quantity) }));
  function change(next) { setRows(next);setQuote(null);action.setError('');setSent(null); }
  const valid = rows.length > 0 && rows.length <= 200 && rows.every(row => Number.isInteger(Number(row.quantity)) && Number(row.quantity) >= 1 && Number(row.quantity) <= 1000000);
  async function refresh() {
    const result = await action.run(() => api({ mode: 'quote', items: items() }));
    if (result.ok) { setQuote(result.value.quote);setLoadError(''); }
  }
  async function send() {
    const result = await action.run(async () => {
      try { return await api({ mode: 'submit', items: items(), expected_quote: quote, request_key: key.current, note }); }
      catch (error) { setUncertain(!error.status || error.status >= 500);throw error; }
    });
    if (result.ok) {
      setUncertain(false);setConfirming(false);setSent(result.value.sent);setRows([]);setQuote(null);key.current = crypto.randomUUID();setNote('');
      await Promise.all([load(), history.reload()]);
    }
  }
  return <section className="supply-order"><div className="page-heading"><span className="eyebrow">AREA NEGOZIO · RIASSORTIMENTO</span><h1>Genera ordine a PROGRE'</h1><p>Prodotti ordinati dai tuoi clienti, raggruppati per codice IT. Le quantità già inviate a PROGRE' sono escluse. Puoi modificare le quantità, aggiungere o eliminare prodotti.</p></div>
    {sent && <div className="notice" role="status">Ordine {sent.number || sent.id} inviato a {sent.agent_name}, agente di riferimento. Totale {money(sent.total)}. Lo trovi nello storico qui sotto.</div>}
    <Alert error={loadError || (!confirming && action.error)} />
    {loading ? <Loading /> : <>{loaded && <><section className="panel"><div className="row-between"><h2>Prodotti da ordinare</h2><button className="button" disabled={action.busy || confirming} onClick={load}>Ricarica dagli ordini clienti</button></div><p className="subtle">Quantità eliminate o ridotte restano disponibili per il prossimo ordine. Gli omaggi ai clienti sono inclusi fra i prodotti da approvvigionare. I prezzi qui sotto sono i tuoi prezzi di acquisto, IVA esclusa.</p><fieldset disabled={action.busy || confirming}><div className="supply-lines">{rows.map(row => { const price = quote?.lines.find(p => p.product_id === row.product_id);return <article className="supply-line" key={row.product_id}><div><strong>{row.name}</strong><small>{row.code} · Richiesti dai clienti: {price?.requested_quantity ?? row.requested_quantity}</small></div><label>Quantità<input aria-label={`Quantità ordine PROGRE ${row.code}`} type="number" min="1" max="1000000" step="1" required value={row.quantity} onChange={e => change(rows.map(p => p.product_id === row.product_id ? { ...p, quantity: e.target.value } : p))} /></label><div><small>Listino acquisto</small><strong>{price ? money(price.list_price) : '—'}</strong></div><div><small>Sconti riservati</small><span>{price ? [price.commercial_discount, price.payment_discount].filter(Boolean).map(s => `${s}%`).join(' + ') || 'Nessuno' : '—'}</span></div><div><small>Prezzo netto / cad.</small><strong>{price ? money(price.unit_price) : '—'}</strong></div><div><small>Imponibile riga</small><strong>{price ? money(price.net_amount) : '—'}</strong></div><button className="icon-button" aria-label={`Elimina ${row.code} dall'ordine PROGRE`} onClick={() => change(rows.filter(p => p.product_id !== row.product_id))}><Trash2 size={18} /></button></article>; })}</div>{!rows.length && <p>Nessun prodotto da ordinare. Puoi aggiungerne dal catalogo.</p>}</fieldset><button className="button" disabled={!valid || action.busy || confirming} onClick={refresh}>Aggiorna prezzi e riepilogo</button>{!quote && rows.length > 0 && <p role="status">Aggiorna il riepilogo per calcolare i prezzi delle quantità inserite.</p>}{quote && <><p>Agente di riferimento: <strong>{quote.agent_name || 'Da assegnare'}</strong></p>{quote.issue && <p className="notice">{quote.issue}</p>}<Totals quote={quote} /></>}<label className="supply-note">Nota per l’agente<textarea maxLength={2000} rows={3} value={note} disabled={action.busy || confirming} onChange={e => setNote(e.target.value)} /></label><button className="button primary" disabled={!valid || !quote?.can_send || action.busy || confirming} onClick={() => { action.setError('');setConfirming(true); }}><Send size={18} />Conferma invio all’agente</button></section>{!confirming && <fieldset disabled={action.busy}><ProductSearch rows={rows} onAdd={row => change([...rows, { ...row, requested_quantity: demand.current.get(row.product_id) || 0 }])} /></fieldset>}
    <section className="panel"><h2>Ordini inviati a PROGRE'</h2><Alert error={history.error} />{(history.data || []).map(order => <article className="supply-history" key={order.id}><div className="row-between"><strong>{order.number || order.id}</strong><span>{date(order.created_at)}</span></div><p>Agente: {order.quote.agent_name} · {order.status === 'bozza' ? 'Inviato all’agente, in attesa di presa in carico' : order.status}</p>{order.quote.lines.map(line => <p key={line.product_id}>{line.code} · {line.quantity} × {line.name} · {money(line.unit_price)} / cad.</p>)}<strong>Totale {money(order.quote.totals.totale_documento)}</strong></article>)}{!history.loading && !history.data?.length && !history.error && <p>Non hai ancora inviato ordini a PROGRE'.</p>}</section></>}{!loaded && <button className="button" onClick={load}>Riprova</button>}</>}
    {confirming && quote && <Modal title="Conferma ordine a PROGRE'" onClose={() => { if (!action.busy && !uncertain) setConfirming(false); }}><h3>Invio a {quote.agent_name}</h3><p>Confermando, l’ordine viene registrato in Workspace e notificato all’agente di riferimento per la presa in carico.</p>{quote.lines.map(row => <p key={row.product_id}>{row.code} · {row.quantity} × {row.name} · {money(row.unit_price)} / cad.</p>)}<Totals quote={quote} />{note && <p>Nota: {note}</p>}<Alert error={action.error} />{uncertain && <p className="notice">L’esito dell’invio non è ancora confermato. Riprova con questo stesso ordine: un invio già registrato non viene duplicato.</p>}<div className="admin-actions"><button className="button" disabled={action.busy || uncertain} onClick={() => setConfirming(false)}>Torna al riepilogo</button><button className="button primary" disabled={action.busy} onClick={send}>{action.busy ? 'Invio in corso…' : uncertain ? 'Verifica e riprova invio' : 'Invia ordine all’agente'}</button></div></Modal>}
  </section>;
}

import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { date, money } from './client';
import useAsync from './useAsync';
import { usePortalRpc } from './usePortalApi';
import { useAction } from './useAction';
import { Alert, Loading } from './ui';

const labels = { sent: 'Inviato', received: 'Ricezione confermata', ready: 'Disponibile per il ritiro' };
export function IncomingOrdersCard({ onOpen }) {
  const orders = useAsync('club_orders');
  useOrderRefresh(orders.reload);
  return <button type="button" className="panel quick-card clickable" onClick={onOpen}><ClipboardList size={28} /><h2>Ordini in arrivo</h2><p>{orders.error ? 'Apri per aggiornare gli ordini.' : `${orders.data?.incoming || 0} ordini da confermare`}</p></button>;
}
function useOrderRefresh(reload) {
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void reload(); };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer);window.removeEventListener('focus', refresh); };
  }, [reload]);
}
export function Orders({ store = false, compact = false }) {
  const rpc = usePortalRpc(), action = useAction();
  const [page, setPage] = useState(0);
  const { data, error, loading, reload } = useAsync('club_orders', { page_offset: page * 20 });
  useOrderRefresh(reload);
  async function update(row, next) {
    const result = await action.run(() => rpc('club_update_order', { target_id: row.id, next_status: next }));
    if (result.ok) await reload();
  }
  const Heading = compact ? 'h3' : 'h1';
  return <section className="product-orders"><div className="page-heading row-between"><Heading>{store ? 'Ordini in arrivo' : 'I miei ordini'}</Heading><button type="button" className="button" onClick={reload} disabled={loading || action.busy}>Aggiorna ordini</button></div><Alert error={error || action.error} />{loading && !data ? <Loading /> : <div className="history-list" aria-live="polite">{(data?.rows || []).map(row => <article className="panel" key={row.id}><div className="row-between"><span>{date(row.created_at)}</span><strong className={`badge order-${row.status}`}>{labels[row.status]}</strong></div><h2>{store ? row.customer_name : row.store_name}</h2><small>Ordine {row.id}</small><ul className="order-lines">{row.items.map((item, i) => <li key={`${item.product_id}-${i}`}>{item.name} · {item.quantity} × {money(item.unit_price)}{item.gift ? ' · Omaggio' : ''}<strong>{money(item.amount)}</strong></li>)}</ul><p className="row-between"><span>Totale</span><strong>{money(row.total)}</strong></p>{row.note && <p>Nota: {row.note}</p>}{row.received_at && <p>Ricezione confermata il {date(row.received_at)}</p>}{row.ready_at && <p className="notice">Prodotti disponibili per il ritiro presso {row.store_name} dal {date(row.ready_at)}.</p>}{store && row.status === 'sent' && <button type="button" className="button primary" disabled={action.busy} onClick={() => update(row, 'received')}>Conferma ricezione ordine</button>}{store && row.status === 'received' && <button type="button" className="button primary" disabled={action.busy} onClick={() => update(row, 'ready')}>Comunica disponibilità per il ritiro</button>}</article>)}{!data?.rows?.length && !error && <p>Nessun ordine presente.</p>}</div>}{(page > 0 || data?.total > 20) && <div className="pagination"><button className="button" disabled={!page || loading} onClick={() => setPage(page - 1)}>Precedenti</button><span>Pagina {page + 1}</span><button className="button" disabled={loading || (page + 1) * 20 >= (data?.total || 0)} onClick={() => setPage(page + 1)}>Successivi</button></div>}</section>;
}

import { Link } from 'react-router-dom';
import { getOrderDisplayStatus } from '../services/orderDisplayStatus';
export default function OrderStatus({ order, basePath }) {
  const status = getOrderDisplayStatus(order);
  return <div><span className={`orders-status ${status.className}`}>{status.label}</span>
    {order.invoice_lookup_error && <small role="status">Verifica fatture non disponibile</small>}
    {(order.linked_invoices || []).map(invoice => <Link key={invoice.id}
      style={{ display: 'block', marginTop: 4 }} to={`${basePath}/fatture/${invoice.id}`}
      onClick={event => event.stopPropagation()}>
      {invoice.sigla} {invoice.serie}/{invoice.numero} · {String(invoice.data_documento || '').split('-').reverse().join('-')}
    </Link>)}
    {order.stato === 'evaso' && order.linked_invoices?.length > 0 && <small>Evaso</small>}
  </div>;
}

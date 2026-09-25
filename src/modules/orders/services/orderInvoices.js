import { supabase } from '../../../lib/supabaseClient';
import { attachInvoiceLinks } from './orderInvoiceReconciliation.js';
export async function enrichOrderInvoices(orders) {
  if (!orders.length) return orders;
  const links = [];
  for (let i = 0; i < orders.length; i += 100) {
    const { data, error } = await supabase.rpc('workspace_order_invoice_links', { p_order_ids: orders.slice(i, i + 100).map(o => o.id) });
    if (error) { console.warn('Verifica fatture ordine non disponibile', error.message); return orders.map(order => ({ ...order, invoice_lookup_error: true })); }
    links.push(...(data || []));
  }
  return attachInvoiceLinks(orders, links);
}

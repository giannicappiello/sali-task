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
  const enriched=attachInvoiceLinks(orders, links);
  if(orders.some(order=>order.mexal_documents?.length)){
    const ids=[...new Set(links.map(link=>link.invoice.id))];
    if(ids.length){
      const {data,error}=await supabase.from('mexal_fatture_vendita').select('id,dati_mexal').in('id',ids);
      if(!error){
        const byId=new Map((data||[]).map(row=>[row.id,row.dati_mexal]));
        for(const order of enriched)for(const invoice of order.linked_invoices){
          const raw=byId.get(invoice.id);
          if(raw)invoice.order_references={numbers:raw.numero_ordine,dates:raw.data_ordine,types:raw.sigla_ordine};
        }
      }
    }
  }
  return enriched;
}

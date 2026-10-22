import { withOrderPreviews } from '../../../shared/amazonOrderAmounts.js';
import { fulfillmentBucket } from './digitalSalesDayModel.js';
import { supabase } from '../../lib/supabaseClient';
import { loadAllQueryRows } from './crmDataset';

// Security-invoker reads: database RLS still applies to every provider/account.
// One paginated batch for the list; no request per customer or truncated totals.
export async function loadCustomerOrders(to, accountId = null) {
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const result = await loadAllQueryRows((from, last) => {
    let query = supabase.from('crm_external_orders')
      .select('id,account_id,external_id,fulfilled_at,raw_summary,ordered_at,stato,gross_revenue,net_revenue,currency,marketplace,attribution_method')
      .not('account_id', 'is', null).lt('ordered_at', end.toISOString());
    if (accountId) query = query.eq('account_id', accountId);
    return query.order('ordered_at', { ascending: false }).order('id').range(from, last);
  });
  if (result.error) return result;
  const orders=result.data || [];
  const ids=orders.filter(row=>fulfillmentBucket(row)==='waiting' && row.net_revenue==null && row.gross_revenue==null).map(row=>row.id);
  const batches=[];
  for (let index=0;index<ids.length;index+=200) {
    const batch=ids.slice(index,index+200);
    batches.push(loadAllQueryRows((from,last)=>supabase.from('crm_external_order_lines').select('id,order_id,quantity,unit_price,line_revenue').in('order_id',batch).order('id').range(from,last)));
  }
  const lines=await Promise.all(batches);
  const failure=lines.find(row=>row.error)?.error;
  return failure ? {data:[],error:failure} : {...result,data:withOrderPreviews(orders,lines.flatMap(row=>row.data || []))};
}

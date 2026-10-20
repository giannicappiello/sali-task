import { supabase } from '../../lib/supabaseClient';
import { loadAllQueryRows } from './crmDataset';

// Security-invoker reads: database RLS still applies to every provider/account.
// One paginated batch for the list; no request per customer or truncated totals.
export function loadCustomerOrders(to, accountId = null) {
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return loadAllQueryRows((from, last) => {
    let query = supabase.from('crm_external_orders')
      .select('id,account_id,external_id,ordered_at,stato,net_revenue,currency,marketplace,attribution_method')
      .not('account_id', 'is', null).lt('ordered_at', end.toISOString());
    if (accountId) query = query.eq('account_id', accountId);
    return query.order('ordered_at', { ascending: false }).order('id').range(from, last);
  });
}

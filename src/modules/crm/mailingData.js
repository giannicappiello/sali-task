import { supabase } from '../../lib/supabaseClient';
import { loadAllQueryRows } from './crmDataset';
import { mailingByAccount } from './mailingModel.js';
export async function loadOnlineMailing(accountId = null) {
  const scoped = (table, fields) => loadAllQueryRows((from, to) => {
    let query = supabase.from(table).select(fields);
    if (accountId) query = query.eq('account_id', accountId);
    return query.order('id').range(from, to);
  });
  const results = await Promise.all([
    scoped('crm_marketing_consents', 'id,account_id,status,source,captured_at,withdrawn_at,created_at:creato_il'),
    scoped('crm_mailing_deliveries', 'id,connection_id,account_id,campaign_id,title,sent_at,delivery_status'),
    scoped('crm_external_customers', 'id,connection_id,account_id'),
    supabase.from('crm_external_connections').select('id,import_state').eq('provider_code', 'mailchimp'),
  ]);
  const error = results.find(row => row.error)?.error;
  if (error) return { data: new Map(), error };
  const ids = new Set(results[3].data.map(row => row.id));
  return { data: mailingByAccount(results[0].data, results[1].data, results[2].data.filter(row => ids.has(row.connection_id)), results[3].data), error: null };
}

import { canReadModule } from '../ai/operational-read.js';
import { safeError } from '../crm/digital-security.js';
import { objectSchema, uuidSchema } from './schema.js';

const channels = {
  sito: { module: 'crm_online_ecommerce', provider: 'woocommerce', type: 'ecommerce' },
  amazon: { module: 'crm_online_amazon', provider: 'amazon_sp_api', type: 'amazon_seller' },
};
const connectionFields = ['id','nome','tipo','provider_code','stato','abilitata','sync_attivo','sync_frequency','ultimo_sync_il','prossima_run_il','ultimo_test_il','ultimo_test_stato','errori_consecutivi','ultimo_errore'];
const orderFields = ['id','connection_id','external_id','marketplace','stato','ordered_at','fulfilled_at','currency','net_revenue','gross_revenue','cox_status','cox_reference','cox_error','mexal_oc','mexal_sync'];
const runFields = ['id','connection_id','sync_type','mode','status','started_at','completed_at','records_read','records_inserted','records_updated','records_failed','duration_ms','error_code','error_message','created_at'];
const offsetSchema = { type: 'integer', minimum: 0, maximum: 100000 };
const daySchema = { type: 'string', format: 'date' };
const checked = result => { if (result.error) throw result.error; return result.data || []; };
const pick = (row, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
const message = value => value == null ? null : safeError({ message: value }).message;
const page = (rows, offset, source, project) => ({ source, rows: rows.slice(0,50).map(project), nextOffset: rows.length > 50 ? offset + 50 : null, readAt: new Date().toISOString() });

function permittedChannel(auth, channel) {
  const config = Object.hasOwn(channels, channel) && channels[channel];
  if (!config || !canReadModule(auth, [config.module])) throw Object.assign(new Error('Canale non autorizzato nel perimetro AI.'), { status:403 });
  return config;
}

export function commerceReadTools(auth) {
  const allowed = Object.keys(channels).filter(channel => canReadModule(auth,[channels[channel].module]));
  if (!allowed.length) return {};
  const channelSchema = { type:'string', enum:allowed };
  const read = (description, schema, execute) => ({ description, inputSchema:schema, effect:'read', execute });
  // The scoped client keeps the CRM's connection, owner/team and run-log RLS.
  // No credentials, configuration, provider payloads or service-role reads.
  async function visibleConnections(input) {
    const config = permittedChannel(auth,input.channel);
    let query = auth.scoped.from('crm_external_connections').select('id').eq('provider_code',config.provider).eq('tipo',config.type).order('id');
    if (input.connectionId) query = query.eq('id',input.connectionId);
    const rows = checked(await query.range(0,1000));
    if (rows.length > 1000) throw Object.assign(new Error('Specificare connectionId per restringere le connessioni.'),{status:400});
    return rows.map(row => row.id);
  }
  return {
    COMMERCE_CONNECTIONS_READ: read('Legge stato e ultimo errore delle integrazioni sito WooCommerce e Amazon Seller. Usare per ordini non sincronizzati. Non restituisce credenziali e non avvia sincronizzazioni.',objectSchema({channel:channelSchema,offset:offsetSchema},['channel']),async input => {
      const config = permittedChannel(auth,input.channel), offset=input.offset || 0;
      const rows = checked(await auth.scoped.from('crm_external_connections').select(connectionFields.join(',')).eq('provider_code',config.provider).eq('tipo',config.type).order('id').range(offset,offset+50));
      return page(rows,offset,'crm_external_connections',row=>({...pick(row,connectionFields),ultimo_errore:message(row.ultimo_errore)}));
    }),
    COMMERCE_ORDERS_SEARCH: read('Cerca ordini originali importati da sito WooCommerce o Amazon per identificativi esterni esatti, connessione e date. Riporta stato e riferimenti/errori Mexal OC o COX. Una ricerca vuota nella cache non dimostra che l’ordine non esista sul provider. Non importa o ritenta ordini.',objectSchema({channel:channelSchema,connectionId:uuidSchema,externalIds:{type:'array',minItems:1,maxItems:20,uniqueItems:true,items:{type:'string',minLength:1,maxLength:100}},from:daySchema,to:daySchema,offset:offsetSchema},['channel']),async input => {
      const offset=input.offset || 0, ids=await visibleConnections(input);
      if (input.from && input.to && input.from > input.to) throw Object.assign(new Error('Intervallo date non valido.'),{status:400});
      if (!ids.length) return page([],offset,'crm_external_orders',row=>row);
      const columns=orderFields.filter(key=>!['mexal_oc','mexal_sync'].includes(key)).join(',')+',mexal_oc:raw_summary->mexal_oc,mexal_sync:raw_summary->mexal_sync';
      let query=auth.scoped.from('crm_external_orders').select(columns).in('connection_id',ids).order('ordered_at',{ascending:false}).order('id');
      if (input.externalIds) query=query.in('external_id',input.externalIds);
      // Days are UTC boundaries; exact external IDs are preferred for diagnostics.
      if (input.from) query=query.gte('ordered_at',input.from+'T00:00:00Z');
      if (input.to) query=query.lt('ordered_at',new Date(Date.parse(input.to+'T00:00:00Z')+86400000).toISOString());
      return {...page(checked(await query.range(offset,offset+50)),offset,'crm_external_orders',row=>({...pick(row,orderFields),cox_error:message(row.cox_error)})),dateTimezone:'UTC',providerLookup:false};
    }),
    COMMERCE_SYNC_RUNS_READ: read('Legge gli esiti persistiti e gli errori delle sincronizzazioni sito WooCommerce o Amazon, con paginazione e permessi del registro CRM. Usare dopo COMMERCE_CONNECTIONS_READ per diagnosticare ordini mancanti. Non avvia o ripete importazioni.',objectSchema({channel:channelSchema,connectionId:uuidSchema,offset:offsetSchema},['channel']),async input => {
      const offset=input.offset || 0, ids=await visibleConnections(input);
      if (!ids.length) return page([],offset,'crm_sync_runs',row=>row);
      const rows=checked(await auth.scoped.from('crm_sync_runs').select(runFields.join(',')).in('connection_id',ids).order('created_at',{ascending:false}).order('id').range(offset,offset+50));
      return page(rows,offset,'crm_sync_runs',row=>({...pick(row,runFields),error_message:message(row.error_message)}));
    }),
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { commerceReadTools } from './commerce-reads.js';
import { validateInput } from './schema.js';

const connectionId='a9f68c36-fc6c-4f4d-8b4f-798c6d0713ba';
function fixture({modules=['crm_online_ecommerce'],tables={}}={}) {
  const calls=[];
  const auth={profile:{ruoli:{}},access:{modules},capabilities:{internal_data:true,allowed_modules:modules},scoped:{from(table){
    const call={table,filters:[]}; calls.push(call);
    const query={select(columns){call.columns=columns;return this;},eq(...args){call.filters.push(['eq',...args]);return this;},in(...args){call.filters.push(['in',...args]);return this;},gte(...args){call.filters.push(['gte',...args]);return this;},lt(...args){call.filters.push(['lt',...args]);return this;},order(){return this;},async range(...args){call.range=args;return {data:tables[table] || []};}};
    return query;
  }}};
  return {auth,calls,tools:commerceReadTools(auth)};
}

test('commerce discovery and execution enforce the channel AI perimeter',async()=>{
  const f=fixture();
  assert.deepEqual(f.tools.COMMERCE_ORDERS_SEARCH.inputSchema.properties.channel.enum,['sito']);
  assert.deepEqual(commerceReadTools({...f.auth,capabilities:{internal_data:false}}),{});
  assert.deepEqual(commerceReadTools({...f.auth,capabilities:{internal_data:true,allowed_modules:[]}}),{});
  await assert.rejects(f.tools.COMMERCE_ORDERS_SEARCH.execute({channel:'amazon'}),{status:403});
  await assert.rejects(f.tools.COMMERCE_CONNECTIONS_READ.execute({channel:'__proto__'}),{status:403});
  assert.equal(f.calls.length,0);
  assert.throws(()=>validateInput(f.tools.COMMERCE_ORDERS_SEARCH.inputSchema,{channel:'sito',externalIds:[]}));
  assert.throws(()=>validateInput(f.tools.COMMERCE_ORDERS_SEARCH.inputSchema,{channel:'sito',from:'2026-02-30'}));
});

test('orders use exact provider identifiers and visible connections with stable pagination',async()=>{
  const rows=Array.from({length:51},(_,n)=>({id:String(n),external_id:'13751',raw_summary:{password:'hidden'},credentials:'hidden',cox_error:'Bearer abc-secret'}));
  const f=fixture({tables:{crm_external_connections:[{id:connectionId}],crm_external_orders:rows}});
  const result=await f.tools.COMMERCE_ORDERS_SEARCH.execute({channel:'sito',connectionId,externalIds:['13751','13753','13778'],from:'2026-10-29',to:'2026-10-31',offset:50});
  assert.equal(result.rows.length,50);assert.equal(result.nextOffset,100);
  assert.equal(result.providerLookup,false);assert.equal(result.dateTimezone,'UTC');
  assert.equal(result.rows[0].cox_error,'Bearer [REDACTED]');
  assert.equal('raw_summary' in result.rows[0],false);assert.equal('credentials' in result.rows[0],false);
  assert.deepEqual(f.calls[0].filters,[['eq','provider_code','woocommerce'],['eq','tipo','ecommerce'],['eq','id',connectionId]]);
  assert.deepEqual(f.calls[1].filters,[['in','connection_id',[connectionId]],['in','external_id',['13751','13753','13778']],['gte','ordered_at','2026-10-29T00:00:00Z'],['lt','ordered_at','2026-11-01T00:00:00.000Z']]);
  assert.deepEqual(f.calls[1].range,[50,100]);
  assert.match(f.calls[1].columns,/mexal_sync:raw_summary->mexal_sync/);
  assert.doesNotMatch(f.calls[1].columns,/(^|,)raw_summary(,|$)|\*/);
});

test('an inaccessible connection never falls back to admin or provider reads',async()=>{
  const f=fixture();
  const result=await f.tools.COMMERCE_ORDERS_SEARCH.execute({channel:'sito',externalIds:['13751']});
  assert.deepEqual(result.rows,[]);assert.equal(f.calls.length,1);
  const logs=await f.tools.COMMERCE_SYNC_RUNS_READ.execute({channel:'sito'});
  assert.deepEqual(logs.rows,[]);assert.equal(f.calls.length,2);
});

test('Amazon connection status and sync errors exclude credentials, cursors and raw log details',async()=>{
  const f=fixture({modules:['crm_online_amazon'],tables:{crm_external_connections:[{id:connectionId,provider_code:'amazon_sp_api',configurazione:{token:'hidden'},import_state:{token:'hidden'},ultimo_errore:'Provider denied Bearer secret'}],crm_sync_runs:[{id:'run',error_message:'Denied https://provider.test/?access_token=secret',details:{token:'hidden'},records_failed:1}]}});
  const status=await f.tools.COMMERCE_CONNECTIONS_READ.execute({channel:'amazon'});
  assert.equal(status.rows[0].ultimo_errore,'Provider denied Bearer [REDACTED]');
  assert.equal('configurazione' in status.rows[0],false);assert.equal('import_state' in status.rows[0],false);
  const result=await f.tools.COMMERCE_SYNC_RUNS_READ.execute({channel:'amazon',connectionId});
  assert.equal(result.rows[0].records_failed,1);assert.equal('details' in result.rows[0],false);
  assert.equal(result.rows[0].error_message,'Denied https://provider.test/?access_token=[REDACTED]');
  assert.deepEqual(f.calls[1].filters,[['eq','provider_code','amazon_sp_api'],['eq','tipo','amazon_seller'],['eq','id',connectionId]]);
  assert.deepEqual(f.calls[2].filters,[['in','connection_id',[connectionId]]]);
});

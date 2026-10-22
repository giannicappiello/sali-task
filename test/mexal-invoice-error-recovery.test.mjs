import test from 'node:test';
import assert from 'node:assert/strict';
import { syncSalesInvoicePage } from '../server/mexal/sync-sales-invoices.js';
function database(){
 const state={next_cursor:'page-1',fte_trovate:false,pagine_vuote_dopo_fte:0};const invoices=new Map();const lines=new Map();const updates=[];
 const client={from(table){
  if(table==='mexal_fatture_sync_stato')return {select(){return {eq(){return {single:async()=>({data:{...state},error:null})};}};},update(values){return {eq:async()=>{updates.push(values);Object.assign(state,values);return {error:null};}};}};
  if(table==='ordini_clienti_cache'||table==='mexal_agenti')return {select(){return {in:async()=>({data:[],error:null})};}};
  if(table==='mexal_fatture_vendita')return {upsert(header){const key=[header.sigla,header.cod_modulo,header.serie,header.numero,header.codice_cliente].join('/');const id=invoices.get(key)?.id||key;invoices.set(key,{...header,id});return {select(){return {single:async()=>({data:{id},error:null})};}};}};
  if(table==='mexal_fatture_vendita_righe')return {delete(){return {eq(){return {not:async()=>({error:null}),then:resolve=>resolve({error:null})};}};},upsert(rows){for(const row of rows)lines.set(row.fattura_id+'/'+row.posizione,row);return Promise.resolve({error:null});}};
  throw Error('Unexpected table '+table);
 }};return {client,state,invoices,lines,updates};
}
for(const next of ['page-2',null])test('failed invoice is retried, never skipped; other invoices import; next='+next,async()=>{
 const db=database();const summaries=[1,2,3].map(numero=>({sigla:'FT',cod_modulo:'E',serie:1,numero,cod_conto:'501.TEST',data_documento:'20261022'}));
 let fail=true;const requested=[];const mexal={async getJson(path){if(path.includes('?')){requested.push('page');assert.ok(path.includes('next=page-1'));return {dati:summaries,next};}const number=Number(path.split('+')[2]);requested.push(number);if(number===2&&fail)throw Error('temporary invoice read failure');return {...summaries.find(row=>row.numero===number),tot_documento:[[1,122]],tot_iva:[[1,22]],codice_articolo:[[1,'IT1']],id_riga:[[1,1]],quantita:[[1,1]],prezzo:[[1,100]],cod_iva:[[1,22]]};}};
 const first=await syncSalesInvoicePage({supabase:db.client,mexal});
 assert.equal(first.success,false);assert.equal(first.completed,false);assert.equal(first.status,'retry');assert.equal(first.failures.length,1);assert.equal(db.invoices.size,2);assert.equal(db.updates.length,0);assert.equal(db.state.next_cursor,'page-1');assert.deepEqual(requested,['page',1,2,3]);
 fail=false;const second=await syncSalesInvoicePage({supabase:db.client,mexal});
 assert.equal(second.success,true);assert.equal(second.completed,next===null);assert.equal(second.failures.length,0);assert.equal(db.invoices.size,3);assert.equal(db.lines.size,3);assert.equal(db.updates.length,1);assert.equal(db.state.next_cursor,next);assert.deepEqual(requested,['page',1,2,3,'page',1,2,3]);
});

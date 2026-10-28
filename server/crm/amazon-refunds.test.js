import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRefundTransaction,normalizePhysicalReturns,refundDispositions,italianRefundStart} from './amazon-refund-model.js';
import {buildRefundCox,refundMarker,refundPlanFingerprint} from './amazon-refund-document.js';
import {exportRefund,synchronizeAmazonRefunds} from './amazon-refunds.js';

const order='405-5097949-2429931';
const money=currencyAmount=>({currencyAmount,currencyCode:'EUR'});
const transaction=()=>({transactionId:'transaction-1',transactionType:'Refund',transactionStatus:'DEFERRED',postedDate:'2026-10-26T05:13:33Z',marketplaceId:'APJ6JRA9NG5V4',totalAmount:money(-12.47),relatedIdentifiers:[{relatedIdentifierName:'ORDER_ID',relatedIdentifierValue:order},{relatedIdentifierName:'REFUND_ID',relatedIdentifierValue:'refund-1'}],breakdowns:[{breakdownType:'Refunded Sales',breakdownAmount:money(-14.7)},{breakdownType:'Refunded Expenses',breakdownAmount:money(2.23)}],items:[{totalAmount:money(-12.47),relatedIdentifiers:[{itemRelatedIdentifierName:'ORDER_ADJUSTMENT_ITEM_ID',itemRelatedIdentifierValue:'line-1'}],contexts:[{contextType:'ProductContext',sku:'IT0058 - FBA',quantityShipped:1}],breakdowns:[{breakdownType:'ProductCharges',breakdownAmount:money(-12.05)},{breakdownType:'Tax',breakdownAmount:money(-2.65)},{breakdownType:'AmazonFees',breakdownAmount:money(2.15)},{breakdownType:'DigitalServicesFee',breakdownAmount:money(0.08)}]}]});
const normalized=()=>({...normalizeRefundTransaction(transaction(),'2026-10-22'),id:'refund-row',connection_id:'connection',export_status:'pending'});
const customer={codice:'501.02156',ragione_sociale:'CLIENTE AMAZON',cod_pagamento:4};
const mappings=[{external_sku:'IT0058 - FBA',codice_mexal:'IT0058',marketplace:'APJ6JRA9NG5V4',status:'matched'}];
const articles=new Map([['RESOAMAZON',{codice:'RESOAMAZON',alq_iva:'22',cod_tp_lotto:''}],['IT0058',{codice:'IT0058',alq_iva:'22',cod_tp_lotto:'aj',gest_rich_lotto:'S'}]]);

test('refund uses customer charges, excludes fees, and preserves one identity across deferred release',()=>{
 const first=normalizeRefundTransaction(transaction(),'2026-10-22');
 assert.equal(first.gross,14.7);assert.equal(first.net,12.05);assert.equal(first.tax,2.65);
 const released=transaction();released.transactionId='released-transaction';released.transactionStatus='DEFERRED_RELEASED';
 assert.equal(normalizeRefundTransaction(released,'2026-10-22').event_key,first.event_key);
 const second=transaction();second.relatedIdentifiers[1].relatedIdentifierValue='refund-2';
 assert.notEqual(normalizeRefundTransaction(second,'2026-10-22').event_key,first.event_key);
 const unsupported=transaction();unsupported.items[0].breakdowns.push({breakdownType:'UnknownCharge',breakdownAmount:money(1)});
 assert.match(normalizeRefundTransaction(unsupported,'2026-10-22').parse_error,/non riconosciuta/);
 const incomplete=transaction();incomplete.items[0].breakdowns=incomplete.items[0].breakdowns.filter(row=>row.breakdownType!=='Tax');
 assert.ok(normalizeRefundTransaction(incomplete,'2026-10-22').parse_error);
});

test('refund cutoff follows Italian midnight, and physical duplicates never restock two units',()=>{
 assert.equal(italianRefundStart('2026-10-22'),'2026-10-21T22:00:00.000Z');
 assert.equal(italianRefundStart('2026-10-28'),'2026-10-27T23:00:00.000Z');
 const row=transaction();row.postedDate='2026-10-21T22:01:00Z';assert.ok(normalizeRefundTransaction(row,'2026-10-22'));
 row.postedDate='2026-10-21T21:59:59Z';assert.equal(normalizeRefundTransaction(row,'2026-10-22'),null);
 const physical={'order-id':order,sku:'IT0058 - FBA',quantity:'1','return-date':'2026-10-27T10:00:00Z','detailed-disposition':'SELLABLE',status:'Unit returned to inventory','license-plate-number':'LPN-1'};
 assert.equal(normalizePhysicalReturns([physical,physical]).length,1);
 assert.throws(()=>normalizePhysicalReturns([physical,{...physical,'detailed-disposition':'DAMAGED'}]),/ambiguo/);
});

test('confirmed units are allocated only once, including refunds before the export cutoff',()=>{
 const refund=normalized(),older={...refund,event_key:'older',posted_at:'2026-10-20T12:00:00Z'};
 const returns=[{sku:'IT0058 - FBA',quantity:1,disposition:'SELLABLE',status:'Unit returned to inventory'}];
 assert.equal(refundDispositions(refund,[older,refund],returns).get('line-1').sellableQuantity,0);
 assert.equal(refundDispositions(refund,[refund],[{...returns[0],disposition:'CUSTOMER_DAMAGED'}]).get('line-1').sellableQuantity,0);
});

test('negative COX uses placeholder until sellable and can split a partially confirmed physical return',()=>{
 const refund={...normalized(),event_id:normalized().event_key};
 const placeholder=buildRefundCox(refund,{customer,articles,mappings});
 assert.deepEqual(placeholder.codice_articolo,[[1,'RESOAMAZON']]);assert.deepEqual(placeholder.quantita,[[1,-1]]);
 assert.equal(placeholder.data_documento,'20261026');assert.ok(placeholder.nota[0][1].includes(order));assert.ok(placeholder.nota[0][1].includes(refundMarker(refund.event_id)));
 const doubled={...refund,gross:29.4,net:24.1,tax:5.3,items:refund.items.map(item=>({...item,quantity:2,gross:29.4,net:24.1,tax:5.3}))};
 const payload=buildRefundCox(doubled,{customer,articles,mappings,dispositions:new Map([['line-1',{confirmed:true,sellableQuantity:1}]])});
 assert.deepEqual(payload.codice_articolo,[[1,'IT0058'],[2,'RESOAMAZON']]);assert.deepEqual(payload.quantita,[[1,-1],[2,-1]]);
 assert.notEqual(refundPlanFingerprint(payload),refundPlanFingerprint(placeholder));
});

function fixture(){
 const refund=normalized(),tables={crm_amazon_refunds:[refund],crm_amazon_physical_returns:[],crm_product_mappings:mappings.map(row=>({...row,connection_id:'connection'})),crm_external_orders:[{id:'original-order',external_id:order,connection_id:'connection',raw_summary:{}}]};
 const calls=[];let document;
 const db={from(name){
  let filters=[],limit=Infinity,update;
  const query={select(){return this;},eq(key,value){filters.push(row=>row[key]===value);return this;},in(key,values){filters.push(row=>values.includes(row[key]));return this;},order(){return this;},limit(n){limit=n;return this;},update(value){update=value;return this;},then(resolve){let rows=(tables[name] || []).filter(row=>filters.every(filter=>filter(row))).slice(0,limit);if(update)rows.forEach(row=>Object.assign(row,update));return Promise.resolve({data:structuredClone(rows)}).then(resolve);}};return query;
 },async rpc(name,args){
  calls.push({name,args});
  if(name==='crm_claim_amazon_refund_service'){
   if(refund.export_status==='processing')return {data:null};
   Object.assign(refund,{export_status:'processing',token:'claim',pending_payload:structuredClone(args.p_payload),pending_fingerprint:args.p_fingerprint});return {data:'claim'};
  }
  if(name==='crm_finish_amazon_refund_service'){
   refund.export_status=args.p_status;refund.cox_reference=args.p_reference;
   if(args.p_status==='emitted'){refund.applied_payload=refund.pending_payload;refund.applied_fingerprint=refund.pending_fingerprint;}
   return {data:null};
  }
  throw Error('Unexpected RPC '+name);
 }};
 const calculated=payload=>{
  const prices=new Map(payload.prezzo),gross=payload.quantita.reduce((sum,[index,qty])=>sum+qty*prices.get(index),0),tax=Math.round(gross/1.22*0.22*100)/100;
  return {tot_imponibile:Math.round((gross-tax)*100)/100,tot_imposta:tax};
 };
 const makeDocument=payload=>({...structuredClone(payload),numero:900,serie:1,tot_documento:[[1,Math.round(payload.quantita.reduce((sum,[i,q])=>sum+q*new Map(payload.prezzo).get(i),0)*100)/100]],tot_iva:[[1,calculated(payload).tot_imposta]],sigla_ordine:[],serie_ordine:[],numero_ordine:[],sigla_doc_orig:[[1,'CO']],serie_doc_orig:[[1,1]],numero_doc_orig:[[1,900]]});
 const mexal={async getJson(path){
  if(path.startsWith('/clienti/'))return customer;
  if(path.startsWith('/articoli/'))return articles.get(decodeURIComponent(path.split('/').at(-1)));
  if(path.startsWith('/progressivi-articoli'))return {cod_articolo:[[1,'IT0058']],id_magazzino:[[1,4]],id_lotto:[[1,99]],qta_inventario:[[1,1]],qta_carico:[],qta_scarico:[]};
  if(path.startsWith('/documenti/'))return structuredClone(document);
  throw Error('Unexpected GET '+path);
 },async postJson(path,payload){
  if(path.startsWith('/lotti/'))return {dati:[{id:99,cod_articolo:'IT0058',stato:'C',caricato:'S',data_carico:'20261001'}]};
  if(path.includes('/ricerca'))return {dati:document?[document]:[]};
  calls.push({method:'POST',payload});document=makeDocument(payload);return {numero:900,serie:1};
 },async putJson(path,payload){calls.push({method:'PUT',path,payload});document=makeDocument(payload);return {};},async calculateDocument(payload){return calculated(payload);}};
 const args={db,connection:{id:'connection'},refund,clientForYear:()=>mexal,fetchFinance:async()=>({transactions:[transaction()],nextToken:null})};
 return {refund,tables,calls,mexal,args,getDocument:()=>document};
}

test('repeated sync never duplicates a refund; late sellable confirmation modifies the same COX with a warehouse-4 lot',async()=>{
 const f=fixture();
 const first=await exportRefund(f.args);assert.equal(first.status,'emitted',first.error);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 assert.equal((await exportRefund(f.args)).status,'unchanged');
 f.tables.crm_amazon_physical_returns.push({connection_id:'connection',amazon_order_id:order,sku:'IT0058 - FBA',quantity:1,disposition:'SELLABLE',status:'Unit returned to inventory'});
 const updated=await exportRefund(f.args);
 assert.equal(updated.updated,true);assert.equal(updated.reference.number,900);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);
 assert.deepEqual(f.getDocument().codice_articolo,[[1,'IT0058']]);assert.deepEqual(f.getDocument().qta_lotto,[[1,-1]]);
 assert.equal(f.getDocument().data_documento,'20261026');
});

test('transport uncertainty is reconciled with the frozen plan and no second document POST',async()=>{
 const f=fixture(),original=f.mexal.postJson;
 f.mexal.postJson=async(path,payload)=>{const result=await original(path,payload);if(!path.includes('/ricerca'))throw Error('Connection lost after commit');return result;};
 const first=await exportRefund(f.args);assert.equal(first.status,'reconciliation_required',first.error);
 assert.equal((await exportRefund(f.args)).status,'emitted');
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});

test('wrong refund totals block the document before any POST, and N41 excludes Amazon-collected VAT',async()=>{
 const blocked=fixture();blocked.mexal.calculateDocument=async()=>({tot_imponibile:-10,tot_imposta:-2.2});
 assert.equal((await exportRefund(blocked.args)).status,'blocked');assert.equal(blocked.calls.filter(c=>c.method==='POST').length,0);
 const f=fixture();f.tables.crm_external_orders[0].raw_summary={tax_collection:{model:'MARKETPLACE_FACILITATOR',vat_code:'N41'}};
 f.mexal.calculateDocument=async()=>({tot_imponibile:-12.05,tot_imposta:0});
 const original=f.mexal.getJson;
 f.mexal.getJson=async path=>{const result=await original(path);return path.startsWith('/documenti/')?{...result,tot_iva:[]}:result;};
 const result=await exportRefund(f.args);
 assert.equal(result.status,'emitted',result.error);assert.deepEqual(f.getDocument().prezzo,[[1,12.05]]);assert.deepEqual(f.getDocument().cod_iva,[[1,'N41']]);
 assert.equal(f.refund.gross,14.7);
});

test('a preexisting manual negative COX requires reconciliation instead of creating a duplicate',async()=>{
 const f=fixture(),post=f.mexal.postJson,get=f.mexal.getJson;
 f.mexal.postJson=async(path,payload)=>path.includes('/ricerca') && payload.filtri.some(row=>row.campo==='nota' && row.valore===order)?{dati:[{numero:800,serie:1,nota:[[1,order]]}]}:post(path,payload);
 f.mexal.getJson=async path=>path.includes('/CO+1+800+')?{quantita:[[1,-1]]}:get(path);
 const result=await exportRefund(f.args);
 assert.equal(result.status,'blocked');assert.match(result.error,/preesistente/);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});

test('financial pages commit the provider cursor and rows together, and never advance on missing data',async()=>{
 const calls=[],state={active:true,phase:'finance',from:'2026-10-21T22:00:00Z',to:'2026-10-28T10:00:00Z',token:'page-1'};
 const connection={id:'connection',marketplace_ids:['APJ6JRA9NG5V4'],amazon_refunds_from:'2026-10-22',amazon_refund_state:state};
 const db={rpc:async(name,args)=>{calls.push({name,args});return {data:null};}};
 const result=await synchronizeAmazonRefunds({db,connection,secrets:{},fetchFinance:async()=>({transactions:[transaction()],nextToken:'page-2'})});
 assert.equal(result.hasMore,true);assert.equal(calls.length,1);assert.deepEqual(calls[0].args.p_expected_state,state);
 assert.equal(calls[0].args.p_rows[0].gross,14.7);assert.equal(calls[0].args.p_next_state.token,'page-2');
 await assert.rejects(()=>synchronizeAmazonRefunds({db,connection,secrets:{},fetchFinance:async()=>{throw Error('provider unavailable');}}),/unavailable/);
 assert.equal(calls.length,1);
});

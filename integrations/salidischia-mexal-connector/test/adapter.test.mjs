import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareOrder,documentPayload } from '../src/order.mjs';
import { MexalAdapter } from '../src/adapter.mjs';
import { Journal } from '../src/journal.mjs';
import { syncOrder } from '../src/sync.mjs';
import { exampleOrder,options,config } from './fixtures.mjs';

// Test bindings are deliberately synthetic. They do not certify the live Mexal schema.
const binding=field=>({field,encoding:'scalar',maxLength:200});
const address=['first_name','last_name','company','address_1','address_2','postcode','city','state','country','phone','email'];
function testConfig(){
 return {...config,paymentCodes:{paypal:1},articleUnit:'PZ',importFrom:'2026-10-01',legacyReconciledThrough:13700,contract:{verified:true,
  customer:{code:binding('codice'),fields:Object.fromEntries([...address.map(k=>[`billing.${k}`,binding(`bill_${k}`)]),...['vat','fiscalCode','pec','sdi','type','externalId'].map(k=>[k,binding(k)])])},
  destination:{code:binding('codice'),fields:Object.fromEntries([...address,'customerCode','externalId'].map(k=>[k,binding(k)]))},
  article:{sku:binding('codice'),unit:binding('um'),tax:binding('iva')},orderCode:binding('riferimento'),orderReference:binding('nota'),orderTotals:{total:binding('totale'),tax:binding('iva_totale')},
 }};
}
function fakeApi(){
 const calls=[],clients=[],destinations=[],orders=[];
 const api={company:'TEST',year:'2026',calls,clients,destinations,orders,
 async request(path,{method='GET',payload}={}){
  calls.push({path,method,payload});
  if(path.startsWith('/articoli/'))return {data:{codice:decodeURIComponent(path.split('/').at(-1)),um:'PZ',iva:'22'}};
  for(const [resource,rows] of [['/clienti',clients],['/indirizzi-spedizione',destinations],['/documenti/ordini-clienti',orders]]){
   if(path.startsWith(resource+'?'))return {data:{dati:rows,next:''}};
   if(path===resource && method==='POST'){
    const code=resource==='/clienti'?'501.12345':resource==='/indirizzi-spedizione'?'754':'OC+1+999';
    const row={...payload,codice:code};if(resource.includes('ordini'))Object.assign(row,{riferimento:code,totale:'160.10',iva_totale:'28.87'});
    rows.push(row);return {data:null,status:201,location:`/webapi/risorse${resource}/${encodeURIComponent(code)}`};
   }
   if(path.startsWith(resource+'/')){
    const code=decodeURIComponent(path.slice(resource.length+1));const row=rows.find(r=>r.codice===code);
    assert.ok(row,'riga simulata esistente');if(method==='PUT'){Object.assign(row,payload);return {data:null,status:204};}
    return {data:row};
   }
  }
  throw new Error('Percorso test inatteso');
 }};return api;
}

test('acquisto guest usa codice compatibile Mexal e conserva il piano originale',async()=>{
 const order=exampleOrder();order.customer_id=0;
 const p=prepareOrder(order,options),c={...testConfig(),externalPrefix:'WOO-'},api=fakeApi(),j=new Journal(':memory:');
 await syncOrder(p,{mexal:new MexalAdapter(api,c),config:c,journal:j,dryRun:false});
 assert.equal(api.clients[0].externalId,'WOO-GUEST-13729');assert.equal(p.customer.externalId,'guest:13729');
 assert.equal(j.get(p.key).plan_hash,p.hash);j.close();
});

test('indirizzo lungo conserva via e civico e tutte le indicazioni nelle note rilette',async()=>{
 const order=exampleOrder();order.billing.address_2='Indicazioni aggiuntive di consegna lunghe ma complete';order.shipping.address_2='Campanello scala B interno 25 lato giardino';
 const p=prepareOrder(order,options),c={...testConfig(),addressMaxLength:48},api=fakeApi(),j=new Journal(':memory:');
 const adapter=new MexalAdapter(api,c);
 await syncOrder(p,{mexal:adapter,config:c,journal:j,dryRun:false});
 assert.equal(api.clients[0].bill_address_1,order.billing.address_1);assert.equal(api.clients[0].bill_address_2,undefined);
 assert.equal(api.clients[0].descr_nota.map(([,v])=>v.replace(/^SDI:/,'')).join(''),order.billing.address_2);
 assert.equal(api.destinations[0].address_1,order.shipping.address_1);
 assert.equal(api.orders[0].descr_porto[0][1]+api.orders[0].nota[0][1].split(' | Porto+: ')[1],order.shipping.address_2);
 api.clients[0].descr_nota[0][1]='TRONCATO';await assert.rejects(adapter.verifyCustomer('501.12345',p.customer),/indicazioni aggiuntive/);j.close();
});

test('guest già cliente per identità fiscale univoca riusa anagrafica senza cambiare codice alternativo',async()=>{
 const order=exampleOrder();order.customer_id=0;const p=prepareOrder(order,options),c={...testConfig(),externalPrefix:'WOO-'},api=fakeApi();
 api.clients.push({codice:'501.77',vat:p.customer.vat,bill_country:'IT',externalId:'WOO-GUEST-13720',data_ult_mod:'20261026 080000'});
 const adapter=new MexalAdapter(api,c);await adapter.preflight(p,c);
 assert.equal(await adapter.ensureCustomer(p.customer),'501.77');await adapter.verifyCustomer('501.77',p.customer);
 assert.equal(api.clients.length,1);assert.equal(api.clients[0].externalId,'WOO-GUEST-13720');
 const next=prepareOrder(exampleOrder(),options);await adapter.preflight(next,c);assert.equal(adapter.customerSource(next.customer).externalId,'WOO-99');
});
test('flusso completo adapter: crea cliente e destinazione, poi OC e rilettura',async()=>{
 const api=fakeApi(),c=testConfig(),j=new Journal(':memory:'),p=prepareOrder(exampleOrder(),options),mexal=new MexalAdapter(api,c);
 const result=await syncOrder(p,{mexal,config:c,journal:j,dryRun:false});
 assert.equal(result.documentRef,'OC+1+999');assert.equal(api.clients[0].sdi,'ABC1234');assert.equal(api.clients[0].pec,'pec@example.invalid');
 assert.equal(api.clients[0].bill_city,'Napoli');assert.equal(api.destinations[0].city,'Roma');assert.deepEqual(api.orders[0].cod_anag_sped,[[1,'754']]);
 assert.equal(api.orders[0].id_pagamento,1);assert.deepEqual(api.orders[0].id_causale,[[1,2]]);
 assert.equal(j.get(p.key).status,'verified');j.close();
});

test('calcolo preventivo e rilettura applicano la stessa regola, con prova nel journal',async()=>{
 for(const crossesBoundary of [false,true]){
  const api=fakeApi(),c={...testConfig(),totalsServiceVerified:true},j=new Journal(':memory:'),p=prepareOrder(exampleOrder(),options);
  const totals={tot_imponibile:131.23,tot_imposta:crossesBoundary?28.90:28.88,spese_trasporto:15,totali_righe:p.lines.map(l=>({imponibile:l.netCents/100,quantita:l.quantity}))};
  api.calculateDocument=async()=>({data:totals});api.documentTotals=async()=>({data:totals});
  const action=syncOrder(p,{mexal:new MexalAdapter(api,c),config:c,journal:j,dryRun:false});
  if(crossesBoundary){await assert.rejects(action,/prima cifra/);assert.equal(api.orders.length,0);}
  else{await action;const saved=j.get(p.key);assert.equal(saved.status,'verified');assert.equal(JSON.parse(saved.verification_json).totalDifferenceCents,1);assert.equal(api.orders.length,1);}
  j.close();
 }
});
test('nazionalità Mexal I per cliente e destinazione italiani, altri paesi bloccati se non mappati',async()=>{
 const api=fakeApi(),c=testConfig(),p=prepareOrder(exampleOrder(),options);
 c.contract.customer.fields.nationality={field:'tp_nazionalita',encoding:'scalar',sources:['billing.country'],values:{IT:'I'}};
 c.contract.destination.fields.nationality={field:'tp_nazionalita',encoding:'scalar',sources:['country'],values:{IT:'I'}};
 const j=new Journal(':memory:');await syncOrder(p,{mexal:new MexalAdapter(api,c),config:c,journal:j,dryRun:false});
 assert.equal(api.clients[0].tp_nazionalita,'I');assert.equal(api.destinations[0].tp_nazionalita,'I');j.close();
 const other=structuredClone(p);other.customer.billing.country='US';await assert.rejects(new MexalAdapter(fakeApi(),c).preflight(other,c),/Valore non mappato/);
});
test('listino e pagamento abituale impostati solo per un nuovo cliente',async()=>{
 for(const existing of [false,true]){
  const api=fakeApi(),c={...testConfig(),customerDefaults:{cod_listino:1},customerPaymentFromOrder:true},p=prepareOrder(exampleOrder(),options),a=new MexalAdapter(api,c);
  if(existing)api.clients.push({codice:'501.77',vat:p.customer.vat,bill_country:'IT',cod_listino:4,cod_pagamento:9,data_ult_mod:'20261021 120000'});
  await a.preflight(p,c);await a.ensureCustomer(p.customer);
  assert.equal(api.clients[0].cod_listino,existing?4:1);assert.equal(api.clients[0].cod_pagamento,existing?9:1);
 }
});
test('assegna la chiave indirizzo obbligatoria e riusa una destinazione già verificata',async()=>{
 const api=fakeApi(),c={...testConfig(),destinationAllocateNumericId:true},p=prepareOrder(exampleOrder(),options),a=new MexalAdapter(api,c);
 api.destinations.push({codice:'10',customerCode:'501.OTHER'},{codice:'7',customerCode:'501.OTHER'});
 await a.preflight(p,c);const code=await a.prepareDestination('501.12345',p);
 assert.equal(api.calls.find(x=>x.path==='/indirizzi-spedizione'&&x.method==='POST').payload.codice,'11');
 assert.equal(await a.prepareDestination('501.12345',p),code);assert.equal(api.calls.filter(x=>x.path==='/indirizzi-spedizione'&&x.method==='POST').length,1);
});
test('rilettura reale: campi spedizione vuoti solo se gratuita, IVA numerica 22,0 equivalente',async()=>{
 const c=testConfig(),order=exampleOrder();order.shipping_lines=[];order.shipping_total='0.00';order.shipping_tax='0.00';order.total_tax='25.57';order.total='141.80';
 const plan=prepareOrder(order,options),payload=documentPayload(plan,'501.1',c);
 let actual={...payload,tp_spese_sped:[],val_spese_sped:[],cod_iva:payload.cod_iva.map(([i])=>[i,' 22,0']),totale:'141.80',iva_totale:'25.57'};
 const adapter=new MexalAdapter({request:async()=>({data:actual})},c);
 await adapter.verifyOrder('OC+1+999',plan,payload);
 const paid=prepareOrder(exampleOrder(),options),paidPayload=documentPayload(paid,'501.1',c);
 actual={...paidPayload,tp_spese_sped:[],val_spese_sped:[],totale:'160.10',iva_totale:'28.87'};
 await assert.rejects(adapter.verifyOrder('OC+1+999',paid,paidPayload),/tp_spese_sped/);
});
test('aggiorna cliente identificato fiscalmente senza cancellare campi assenti nel sito',async()=>{
 const api=fakeApi(),c=testConfig(),p=prepareOrder(exampleOrder(),options),adapter=new MexalAdapter(api,c);
 api.clients.push({codice:'501.77',vat:p.customer.vat,bill_country:'IT',fiscalCode:'MANTENERE',pec:'vecchia@example.invalid',data_ult_mod:'20261021 120000'});
 await adapter.preflight(p,c);const code=await adapter.ensureCustomer(p.customer);await adapter.verifyCustomer(code,p.customer);
 assert.equal(code,'501.77');assert.equal(api.clients.length,1);assert.equal(api.clients[0].fiscalCode,'MANTENERE');assert.equal(api.clients[0].pec,p.customer.pec);
 assert.equal(api.calls.find(call=>call.method==='PUT').payload.data_ult_mod,'20261021 120000');
});
test('non confonde clienti con stessa partita IVA in paesi diversi',async()=>{
 const api=fakeApi(),c=testConfig(),p=prepareOrder(exampleOrder(),options),adapter=new MexalAdapter(api,c);
 api.clients.push({codice:'501.77',vat:p.customer.vat,bill_country:'DE'});
 await adapter.preflight(p,c);await adapter.ensureCustomer(p.customer);assert.equal(api.clients.length,2);
});
test('blocca anagrafiche fiscali ambigue prima di qualsiasi scrittura',async()=>{
 const api=fakeApi(),c=testConfig(),p=prepareOrder(exampleOrder(),options),adapter=new MexalAdapter(api,c);
 api.clients.push(...['501.77','501.78'].map(codice=>({codice,vat:p.customer.vat,bill_country:'IT'})));
 await adapter.preflight(p,c);await assert.rejects(adapter.ensureCustomer(p.customer),/ambigua/);assert.equal(api.calls.filter(x=>x.method!=='GET').length,0);
});
test('blocca campo PEC non mappato e troncamento indirizzo nel preflight',async()=>{
 for(const mutate of [c=>delete c.contract.customer.fields.pec,c=>c.contract.customer.fields['billing.address_1'].maxLength=2]){
  const api=fakeApi(),c=testConfig(),p=prepareOrder(exampleOrder(),options);mutate(c);
  await assert.rejects(new MexalAdapter(api,c).preflight(p,c));assert.equal(api.calls.length,0);
 }
});
test('blocca unità di misura e codice IVA differenti prima di scrivere',async()=>{
 for(const field of ['um','iva']){
  const api=fakeApi(),c=testConfig(),p=prepareOrder(exampleOrder(),options),original=api.request;
  api.request=async(...args)=>{const response=await original(...args);if(args[0].startsWith('/articoli'))response.data[field]='DIFFERENTE';return response;};
  await assert.rejects(new MexalAdapter(api,c).preflight(p,c));assert.equal(api.calls.filter(x=>x.method!=='GET').length,0);
 }
});
test('blocca cliente e anno sbagliati e ordini antecedenti al subentro',async()=>{
 for(const mutate of [api=>api.company='ALTRO',api=>api.year='2025']){const api=fakeApi(),c=testConfig();mutate(api);await assert.rejects(new MexalAdapter(api,c).preflight(prepareOrder(exampleOrder(),options),c),/Azienda/);}
 const api=fakeApi(),c={...testConfig(),legacyReconciledThrough:13729};await assert.rejects(new MexalAdapter(api,c).preflight(prepareOrder(exampleOrder(),options),c),/precedente/);
});
test('paginazione ripetuta: impossibile concludere la ricerca e creare duplicati',async()=>{
 const api={async request(){return {data:{dati:[],next:'same'}};}};
 await assert.rejects(new MexalAdapter(api,testConfig()).collection('/clienti'),/ripetuta/);
});
test('API accetta scrittura ma non salva PEC: nessun OC creato',async()=>{
 const api=fakeApi(),c=testConfig(),j=new Journal(':memory:'),p=prepareOrder(exampleOrder(),options),original=api.request;
 api.request=async(...args)=>{const result=await original(...args);if(args[0].startsWith('/clienti/'))result.data.pec='';return result;};
 await assert.rejects(syncOrder(p,{mexal:new MexalAdapter(api,c),config:c,journal:j,dryRun:false}),/pec/);assert.equal(api.orders.length,0);j.close();
});
test('rilettura prezzi cambiati dal listino Mexal: invio non verificato',async()=>{
 const api=fakeApi(),c=testConfig(),j=new Journal(':memory:'),p=prepareOrder(exampleOrder(),options),original=api.request;
 api.request=async(...args)=>{const result=await original(...args);if(args[0].startsWith('/documenti/ordini-clienti/'))result.data.prezzo=[[1,999]];return result;};
 await assert.rejects(syncOrder(p,{mexal:new MexalAdapter(api,c),config:c,journal:j,dryRun:false}),/prezzo/);assert.equal(j.get(p.key).status,'reconciliation_required');j.close();
});

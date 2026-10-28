import {financialTransactions,fbaReturnReport} from './amazon-returns-source.js';
import {normalizeRefundTransaction,normalizePhysicalReturns,refundDispositions,italianRefundStart} from './amazon-refund-model.js';
import {buildRefundCox,verifyRefundCox,verifyRefundTotals,refundMarker,refundPlanFingerprint,refundUpdatePayload} from './amazon-refund-document.js';
import {prepareReturnLots} from './amazon-fifo.js';
import {AMAZON_CUSTOMER_CODE,COX_RESOURCE,amazonOrderDate,createdCoxReference} from './amazon-cox.js';

const checked=async pending=>{const result=await pending;if(result.error)throw result.error;return result.data;};
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const scalar=value=>Array.isArray(value)?value[0]?.[1]:value;
const cents=value=>value!=null && value!=='' && Number.isFinite(Number(value))?Math.round(Number(value)*100):null;
const note=row=>String(scalar(row.nota) || '').trim();
const stateSave=(db,id,state)=>checked(db.from('crm_external_connections').update({amazon_refund_state:state}).eq('id',id));

async function findRefundDocument(mexal,refund,legacy=false){
 const marker=refundMarker(refund.event_key),rows=[],seen=new Set();let next;
 do{
  const page=await mexal.postJson(COX_RESOURCE+'/ricerca?max=100'+(next?'&next='+encodeURIComponent(next):''),{filtri:[{campo:'sigla',condizione:'=',valore:'CO'},{campo:'cod_modulo',condizione:'=',valore:'X'},{campo:'cod_conto',condizione:'=',valore:AMAZON_CUSTOMER_CODE},{campo:'nota',condizione:'contiene',valore:legacy?refund.amazon_order_id:marker}]});
  assert(Array.isArray(page.dati),'Ricerca COX reso incompleta.');
  rows.push(...page.dati.filter(row=>legacy?!note(row).includes('RESO:') && note(row).includes(refund.amazon_order_id):note(row).includes(marker)));
  next=page.next;assert(!next || !seen.has(next),'Cursore ricerca reso ripetuto.');seen.add(next);assert(seen.size<=50,'Ricerca reso troppo estesa.');
 }while(next);
 if(legacy)return rows;
 assert(rows.length<=1,'Più COX riportano lo stesso identificativo rimborso.');return rows[0];
}

async function prepareRefund(db,connection,refund,mexal,secrets,fetchFinance){
 assert(!refund.parse_error && !refund.source_conflict && refund.gross>0,refund.parse_error || 'Dati finanziari del rimborso da riconciliare.');
 const customer=await mexal.getJson('/clienti/'+AMAZON_CUSTOMER_CODE);
 const skus=[...new Set(refund.items.map(item=>item.sku))];
 const mappings=await checked(db.from('crm_product_mappings').select('external_sku,marketplace,status,codice_mexal').eq('connection_id',connection.id).eq('marketplace',refund.marketplace).in('external_sku',skus).limit(1001));
 let events=await checked(db.from('crm_amazon_refunds').select('event_key,posted_at,items').eq('connection_id',connection.id).eq('amazon_order_id',refund.amazon_order_id).order('posted_at').order('event_key').limit(1001));
 const physical=await checked(db.from('crm_amazon_physical_returns').select('sku,quantity,disposition,status').eq('connection_id',connection.id).eq('amazon_order_id',refund.amazon_order_id).limit(1001));
 assert(events.length<=1000 && physical.length<=1000 && mappings.length<=1000,'Dettagli reso troppo estesi: nessuna pagina troncata.');
 if(physical.some(row=>row.disposition==='SELLABLE' && row.status==='Unit returned to inventory')){
  // A refund before the configured export cutoff may already own a physical
  // unit. Read this order's history for allocation only, never export it.
  const history=new Map(),seen=new Set();let next;
  do{
   const page=await fetchFinance(connection,secrets,{orderId:refund.amazon_order_id,nextToken:next});
   for(const row of page.transactions){const normalized=normalizeRefundTransaction(row,'1900-01-01');if(normalized){assert(!normalized.parse_error,'Storia rimborsi non verificabile per il rientro merce: '+normalized.parse_error);history.set(normalized.event_key,normalized);}}
   next=page.nextToken;assert(!next || !seen.has(next),'Cursore storia rimborsi ripetuto.');seen.add(next);assert(seen.size<=10,'Storia rimborsi troppo estesa.');
  }while(next);
  for(const event of events)history.set(event.event_key,event);
  events=[...history.values()];
 }
 const dispositions=refundDispositions(refund,events,physical),articles=new Map();
 const codes=new Set(['RESOAMAZON']);
 for(const item of refund.items)if(dispositions.get(item.line_id)?.sellableQuantity>0){
  const matches=mappings.filter(m=>m.external_sku===item.sku && m.status==='matched');
  assert(matches.length===1 && matches[0].codice_mexal,'SKU reso vendibile senza associazione: '+item.sku);codes.add(matches[0].codice_mexal);
 }
 for(const code of codes)articles.set(code,await mexal.getJson('/articoli/'+encodeURIComponent(code)));
 const orders=await checked(db.from('crm_external_orders').select('id,raw_summary').eq('connection_id',connection.id).eq('external_id',refund.amazon_order_id).limit(2));
 assert(orders.length===1,'Ordine originale del rimborso non importato o non univoco.');
 const classification=orders[0].raw_summary?.tax_collection;
 if(classification)assert(classification.model==='MARKETPLACE_FACILITATOR' && classification.vat_code==='N41','Regime fiscale rimborso non configurato.');
 const documentRefund={...refund,event_id:refund.event_key};
 if(classification){
  documentRefund.vat_code='N41';documentRefund.gross=refund.net;documentRefund.tax=0;
  documentRefund.items=refund.items.map(item=>({...item,gross:item.net,tax:0}));
 }
 const payload=buildRefundCox(documentRefund,{customer,articles,mappings,dispositions});
 const fingerprint=refundPlanFingerprint(payload);
 const summary={items:refund.items.map(item=>({line_id:item.line_id,sku:item.sku,quantity:item.quantity,sellableQuantity:dispositions.get(item.line_id)?.sellableQuantity || 0,physicalStatus:physical.some(row=>row.sku===item.sku && row.disposition!=='SELLABLE')?'NOT_SELLABLE':'UNCONFIRMED'})),...(classification?{vatCode:'N41',amazonCollectedTax:refund.tax}:{})};
 return {payload,fingerprint,summary,documentRefund,articles};
}

export async function reconcileRefund({db,refund,clientForYear}){
 try{
  assert(refund.pending_payload && refund.token,'Piano di riconciliazione del reso assente.');
  const mexal=clientForYear(amazonOrderDate(refund.posted_at).slice(0,4)),found=await findRefundDocument(mexal,refund);
  if(!found)return {status:'reconciliation_required',error:'COX reso non trovato: nessuna nuova emissione automatica.'};
  const actual=await mexal.getJson(COX_RESOURCE+`/CO+${Number(found.serie)}+${Number(found.numero)}+${AMAZON_CUSTOMER_CODE}`);
  const isN41=refund.pending_payload.cod_iva?.every(([,code])=>String(code).toUpperCase()==='N41');
  const financial={...refund,event_id:refund.event_key,...(isN41?{gross:refund.net,tax:0,vat_code:'N41'}:{})};
  const reference=verifyRefundCox(actual,refund.pending_payload,financial);
  await checked(db.rpc('crm_finish_amazon_refund_service',{p_id:refund.id,p_token:refund.token,p_status:'emitted',p_reference:reference,p_error:null}));
  return {status:'emitted',reference,reconciled:true};
 }catch(error){return {status:'reconciliation_required',error:String(error.message).slice(0,500)};}
}

export async function exportRefund({db,connection,refund,clientForYear,secrets,fetchFinance=financialTransactions}){
 if(['processing','reconciliation_required'].includes(refund.export_status))return reconcileRefund({db,refund,clientForYear});
 let token,writeStarted=false,knownReference=refund.cox_reference;
 try{
  const mexal=clientForYear(amazonOrderDate(refund.posted_at).slice(0,4));
  const prepared=await prepareRefund(db,connection,refund,mexal,secrets,fetchFinance);
  if(refund.export_status==='emitted' && refund.applied_fingerprint===prepared.fingerprint)return {status:'unchanged',reference:refund.cox_reference};
  let payload=prepared.payload,actual;
  // Preserve the previous lot selection until a physical disposition change
  // requires a real document update. Merely changing current FIFO is no update.
  payload=await prepareReturnLots(mexal,payload,prepared.articles);
  if(knownReference){
   actual=await mexal.getJson(COX_RESOURCE+`/CO+${knownReference.series}+${knownReference.number}+${AMAZON_CUSTOMER_CODE}`);
   assert(refund.applied_payload,'Piano originale COX reso non disponibile.');
   verifyRefundCox(actual,refund.applied_payload,prepared.documentRefund);
   payload=refundUpdatePayload(actual,payload);
  }
  token=await checked(db.rpc('crm_claim_amazon_refund_service',{p_id:refund.id,p_payload:payload,p_fingerprint:prepared.fingerprint,p_disposition:prepared.summary}));
  if(!token)return {status:'skipped'};
  if(!knownReference){
   const found=await findRefundDocument(mexal,refund);
   if(found){
    writeStarted=true;knownReference={year:payload.data_documento.slice(0,4),series:Number(found.serie),number:Number(found.numero),date:payload.data_documento};
    actual=await mexal.getJson(COX_RESOURCE+`/CO+${knownReference.series}+${knownReference.number}+${AMAZON_CUSTOMER_CODE}`);
   }else{
    for(const legacy of await findRefundDocument(mexal,refund,true)){
     const document=await mexal.getJson(COX_RESOURCE+`/CO+${Number(legacy.serie)}+${Number(legacy.numero)}+${AMAZON_CUSTOMER_CODE}`);
     assert(!(document.quantita || []).some(([,quantity])=>Number(quantity)<0),'COX reso preesistente senza identificativo rimborso: verificare '+legacy.serie+'/'+legacy.numero+' prima di emettere.');
    }
   }
  }
  if(!actual || refund.cox_reference){
   const calculated=await mexal.calculateDocument(payload),net=cents(calculated.tot_imponibile),tax=cents(calculated.tot_imposta);
   assert(net!==null && tax!==null,'Totali preventivi COX reso non disponibili.');
   verifyRefundTotals(prepared.documentRefund,net+tax,tax);
   writeStarted=true;
   if(knownReference)await mexal.putJson(COX_RESOURCE+`/CO+${knownReference.series}+${knownReference.number}+${AMAZON_CUSTOMER_CODE}`,payload);
   else{
    const created=await mexal.postJson(COX_RESOURCE,payload),reference=createdCoxReference(created);
    if(reference)knownReference={...reference,year:payload.data_documento.slice(0,4),date:payload.data_documento};
    else{
     const found=await findRefundDocument(mexal,refund);assert(found,'COX reso inviato: riferimento da riconciliare.');
     knownReference={series:Number(found.serie),number:Number(found.numero),year:payload.data_documento.slice(0,4),date:payload.data_documento};
    }
   }
   actual=await mexal.getJson(COX_RESOURCE+`/CO+${knownReference.series}+${knownReference.number}+${AMAZON_CUSTOMER_CODE}`);
  }
  const reference=verifyRefundCox(actual,payload,prepared.documentRefund);
  await checked(db.rpc('crm_finish_amazon_refund_service',{p_id:refund.id,p_token:token,p_status:'emitted',p_reference:reference,p_error:null}));
  return {status:'emitted',reference,updated:Boolean(refund.cox_reference)};
 }catch(error){
  const status=writeStarted?'reconciliation_required':'blocked',message=String(error.message).slice(0,500);
  if(token)await checked(db.rpc('crm_finish_amazon_refund_service',{p_id:refund.id,p_token:token,p_status:status,p_reference:knownReference,p_error:message}));
  else await checked(db.from('crm_amazon_refunds').update({error:message,...(refund.export_status==='emitted'?{}:{export_status:status})}).eq('id',refund.id));
  return {status,error:message};
 }
}

export async function synchronizeAmazonRefunds({db,connection,secrets,clientForYear,now=new Date(),fetchFinance=financialTransactions,fetchPhysical=fbaReturnReport}){
 const from=italianRefundStart(connection.amazon_refunds_from),previous=structuredClone(connection.amazon_refund_state || {});
 if(previous.retryAt && Date.parse(previous.retryAt)>now.getTime()){
  await stateSave(db,connection.id,{...previous,active:false});
  return {hasMore:false,warning:previous.lastError,failed:1};
 }
 let state={...previous,active:true};
 const save=next=>stateSave(db,connection.id,next);
 if(!state.phase){
  const target=new Date(now.getTime()-180000).toISOString();
  const start=new Date(Math.max(Date.parse(from),Date.parse(state.coveredAt || from)-90*86400000)).toISOString();
  state={...state,phase:'finance',from:start,to:new Date(Math.min(Date.parse(target),Date.parse(start)+179*86400000)).toISOString(),target,token:null};
  await save(state);return {hasMore:true,recordsRead:0};
 }
 // The manager holds the commerce lease; the RPC commits rows and cursor as
 // one transaction so a provider page can never be advanced without its data.
 const store=(kind,rows,next)=>checked(db.rpc('crm_store_amazon_refund_page_service',{p_connection_id:connection.id,p_expected_state:previous,p_kind:kind,p_rows:rows,p_next_state:next}));
 if(state.phase==='finance'){
  let page;
  try{page=await fetchFinance(connection,secrets,{from:state.from,to:state.to,nextToken:state.token});}
  catch(error){
   if(state.token && error.code==='provider_400' && /token/i.test(error.message)){await save({...state,token:null});return {hasMore:true,recordsRead:0};}
   throw error;
  }
  const markets=new Set(connection.marketplace_ids || []);
  const rows=page.transactions.filter(row=>!row.marketplaceId || !markets.size || markets.has(row.marketplaceId)).map(row=>normalizeRefundTransaction(row,connection.amazon_refunds_from)).filter(Boolean);
  const next={...state,token:page.nextToken || null};
  if(!page.nextToken){
   if(state.target && Date.parse(state.to)<Date.parse(state.target)){
    next.from=state.to;next.to=new Date(Math.min(Date.parse(state.target),Date.parse(state.to)+179*86400000)).toISOString();
   }else{
    next.phase='physical';next.coveredAt=state.to;
    // Re-read physical confirmations from the configured start, including late
    // disposition changes for a COX originally exported with RESOAMAZON.
    next.reportFrom=from;
   }
  }
  await store('finance',rows,next);return {hasMore:true,recordsRead:rows.length};
 }
 if(state.phase==='physical'){
  const deferPhysical=async error=>{
   const warning=String(error.message || error).slice(0,500);
   await save({...state,phase:'emit',after:null,physicalWarning:warning,reportId:null,requestedAt:null});
   return {hasMore:true,recordsRead:0,warning};
  };
  if(Date.parse(state.reportFrom)>=Date.parse(state.to)){
   await save({...state,phase:'emit',after:null,physicalCoveredAt:state.to});return {hasMore:true,recordsRead:0};
  }
  const end=new Date(Math.min(Date.parse(state.to),Date.parse(state.reportFrom)+30*86400000)).toISOString();
  let report;
  try{report=await fetchPhysical(connection,secrets,{from:state.reportFrom,to:end,reportId:state.reportId});}
  catch(error){return deferPhysical(error);}
  if(report.status==='DONE'){
   const next={...state,reportFrom:end,reportId:null,requestedAt:null};
   if(end===state.to){next.phase='emit';next.after=null;next.physicalCoveredAt=state.to;}
   const rows=normalizePhysicalReturns(report.rows);await store('physical',rows,next);return {hasMore:true,recordsRead:rows.length};
  }
  if(!['IN_QUEUE','IN_PROGRESS'].includes(report.status))return deferPhysical('Report resi Amazon '+report.status+': vendibilità non aggiornata, usate solo le conferme già acquisite.');
  if(state.requestedAt && now.getTime()-Date.parse(state.requestedAt)>=600000)return deferPhysical('Report resi Amazon ancora in elaborazione: vendibilità da aggiornare alla prossima sincronizzazione.');
  await save({...state,reportId:report.reportId,requestedAt:state.requestedAt || now.toISOString()});
  return {hasMore:true,recordsRead:0,retryAfterMs:30000};
 }
 assert(state.phase==='emit','Fase rimborsi Amazon non valida.');
 let query=db.from('crm_amazon_refunds').select('*').eq('connection_id',connection.id).order('id').limit(2);
 if(state.after)query=query.gt('id',state.after);
 const rows=await checked(query),batch=rows.slice(0,1),results=[];
 for(const refund of batch)results.push({order:refund.amazon_order_id,event:refund.event_key,...await exportRefund({db,connection,refund,clientForYear,secrets,fetchFinance})});
 const hasMore=rows.length>1;
 const catchUp=!hasMore && Date.parse(connection.import_state?.to || '')>Date.parse(state.to);
 await save(hasMore?{...state,after:batch.at(-1).id}:catchUp?{coveredAt:state.to,physicalCoveredAt:state.physicalCoveredAt,active:true}:{coveredAt:state.to,physicalCoveredAt:state.physicalCoveredAt,lastCompletedAt:now.toISOString(),active:false,...(state.physicalWarning?{lastError:state.physicalWarning}:{})});
 return {hasMore:hasMore || catchUp,recordsRead:0,results,emitted:results.filter(r=>r.status==='emitted' && !r.updated && !r.reconciled).length,updated:results.filter(r=>r.updated).length,failed:results.filter(r=>['blocked','reconciliation_required'].includes(r.status)).length};
}

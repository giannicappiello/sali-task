import { gunzipSync } from 'node:zlib';
import { request, refreshAccessToken } from './digital-provider-adapters.js';
import { safeFetch } from './digital-security.js';

const isTimestamp = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

// Keep only order identifiers and actual shipment dates. Never persist report PII.
export function shipmentReportDates(input) {
  const records=[];let row=[],cell='',quoted=false;
  const text=String(input).replace(/^\uFEFF/,'');
  for(let i=0;i<=text.length;i++) {
    const c=text[i] || '\n';
    if(c==='"') {if(quoted && text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(!quoted && (c==='\t'||c==='\n')) {row.push(cell.replace(/\r$/,''));cell='';if(c==='\n'){if(row.some(Boolean)) records.push(row);row=[];}}
    else cell+=c;
  }
  if(quoted) throw new Error('Report spedizioni Amazon incompleto.');
  const header=records.shift() || [],id=header.indexOf('amazon-order-id'),date=header.indexOf('shipment-date');
  if(id<0 || date<0) throw new Error('Report Amazon senza numero ordine o data effettiva di spedizione.');
  const dates=new Map();
  for(const record of records) {
    if(!/^\d{3}-\d{7}-\d{7}$/.test(record[id]) || !isTimestamp(record[date])) throw new Error('Riga spedizione Amazon non valida.');
    const shipped=new Date(record[date]).toISOString();
    if(!dates.has(record[id]) || shipped>dates.get(record[id])) dates.set(record[id],shipped);
  }
  return [...dates].map(([external_id,shipped_at])=>({external_id,shipped_at}));
}

export function packageShippedAt(order) {
  if(order.fulfillment?.fulfillmentStatus !== 'SHIPPED') return null;
  const packages=(order.packages || []).filter(p=>!['CANCELLED','UNDELIVERABLE'].includes(p.packageStatus?.status));
  if(!packages.length || packages.some(p=>!p.shipTime || !isTimestamp(p.shipTime))) return null;
  return new Date(Math.max(...packages.map(p=>Date.parse(p.shipTime)))).toISOString();
}

async function checked(result) {if(result.error) throw result.error;return result.data;}
export async function synchronizeShipmentDates({db,connection,secrets,fetcher=safeFetch,now=new Date(),coverageThrough}) {
  // Reports enrich already imported orders before any COX. Old dates are never guessed.
  let state=structuredClone(connection.amazon_shipment_state || {});
  // A report from the morning does not cover orders imported that evening.
  // Bind coverage to the committed order window, not just its calendar day.
  const requested=coverageThrough || connection.import_state?.to;
  const cutoff=now.getTime()-180000;
  const requiredThrough=new Date(isTimestamp(requested)?Math.min(Date.parse(requested),cutoff):cutoff).toISOString();
  if(!state.target && !state.reportId && connection.amazon_shipments_covered_at && Date.parse(connection.amazon_shipments_covered_at)>=Date.parse(requiredThrough))return {hasMore:false};
  if(state.retryAt && Date.parse(state.retryAt)>now.getTime()) return {hasMore:false,warning:state.lastError,deferred:true};
  // Amazon's historical window moves while a backfill runs. Avoid requesting
  // the exact 18-month boundary, which can already be outside retention by POST.
  const available=new Date(now);available.setUTCMonth(available.getUTCMonth()-18);available.setUTCDate(available.getUTCDate()+1);available.setUTCHours(0,0,0,0);
  if(!state.target) {
    const floor=available;
    const start=connection.amazon_shipments_covered_at ? new Date(Date.parse(connection.amazon_shipments_covered_at)-14*86400000) : floor;
    state={target:requiredThrough,floor:start.toISOString(),end:requiredThrough,reports:0};
  }
  if(Date.parse(state.floor)<available.getTime()) {
    state.floor=available.toISOString();state.unavailableBefore=state.floor;
    if(state.start && Date.parse(state.start)<available.getTime()) {delete state.reportId;delete state.requestedAt;}
  }
  if(Date.parse(state.end)<=Date.parse(state.floor)) {
    await checked(await db.rpc('crm_store_amazon_shipment_dates_service',{p_connection_id:connection.id,p_rows:[],p_state:{},p_covered_at:state.target}));
    return {hasMore:false,recordsRead:0,resource:'amazon_shipments',reports:state.reports};
  }
  const root={eu:'https://sellingpartnerapi-eu.amazon.com',na:'https://sellingpartnerapi-na.amazon.com',fe:'https://sellingpartnerapi-fe.amazon.com'}[connection.configurazione?.region || 'eu'];
  if(!root) throw new Error('Regione Amazon non valida.');
  const token=await refreshAccessToken(connection,secrets,fetcher);
  const headers={'x-amz-access-token':token.access_token,'content-type':'application/json',accept:'application/json'};
  const call=(path,options={})=>request(root+'/reports/2021-06-30/'+path,{headers,timeoutMs: 300000,...options},fetcher,'Report spedizioni FBA');
  let rows=[],wait=0;
  if(!state.reportId) {
    state.start=new Date(Math.max(Date.parse(state.floor),Date.parse(state.end)-30*86400000)).toISOString();
    const created=await call('reports',{method:'POST',body:JSON.stringify({reportType:'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL',dataStartTime:state.start,dataEndTime:state.end,marketplaceIds:connection.marketplace_ids?.length ? connection.marketplace_ids : connection.configurazione?.marketplace_ids})});
    if(!created.reportId) throw new Error('Amazon non ha restituito il riferimento del report spedizioni.');
    state.reportId=created.reportId;state.requestedAt=now.toISOString();delete state.retryAt;wait=30000;
  } else {
    const report=await call('reports/'+encodeURIComponent(state.reportId));
    if(['IN_QUEUE','IN_PROGRESS'].includes(report.processingStatus)) {
      if(state.requestedAt && now.getTime()-Date.parse(state.requestedAt)>600000) {
        state.lastError='Report spedizioni Amazon ancora in elaborazione; gli ordini continuano a essere importati.';
        state.retryAt=new Date(now.getTime()+3600000).toISOString();
      } else wait=30000;
    }
    else if(report.processingStatus==='DONE') {
      const doc=await call('documents/'+encodeURIComponent(report.reportDocumentId));
      if(!doc.url || ![undefined,'GZIP'].includes(doc.compressionAlgorithm)) throw new Error('Formato report spedizioni non supportato.');
      // No Amazon authorization header is ever sent to the signed download URL.
      const response=await fetcher(doc.url,{binary:true,timeoutMs: 300000,maxBytes:2097152});
      if(!response.ok) throw new Error('Download report spedizioni Amazon non riuscito.');
      const content=doc.compressionAlgorithm==='GZIP' ? gunzipSync(response.data,{maxOutputLength:20*1024*1024}).toString('utf8') : String(response.data);
      rows=shipmentReportDates(content);state.reports++;
      state.end=state.start;delete state.reportId;delete state.requestedAt;delete state.lastError;delete state.retryAt;
    } else if(report.processingStatus==='CANCELLED') {state.end=state.start;delete state.reportId;}
    else if(report.processingStatus==='FATAL') {
      state.lastError=`Report spedizioni Amazon FATAL (${state.start} - ${state.end}). Date non disponibili: riprova differita; importazione ordini indipendente.`;
      state.failedReportId=state.reportId;delete state.reportId;delete state.requestedAt;
      state.retryAt=new Date(now.getTime()+900000).toISOString();
    } else throw new Error('Report spedizioni Amazon non completato: '+String(report.processingStatus || 'stato sconosciuto')+'. Nessuna data inventata.');
  }
  const done=!state.reportId && Date.parse(state.end)<=Date.parse(state.floor);
  await checked(await db.rpc('crm_store_amazon_shipment_dates_service',{p_connection_id:connection.id,p_rows:rows,p_state:done?{}:state,p_covered_at:done?state.target:null}));
  return {hasMore:!done && !state.retryAt,retryAfterMs:wait,recordsRead:rows.length,resource:'amazon_shipments',reports:state.reports,
    ...(state.retryAt?{warning:state.lastError,deferred:true}:{})};
}

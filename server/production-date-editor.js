import { randomUUID } from 'node:crypto';
import { HMAC_HEADERS, signProductionMessage } from './progremes-production-hmac.js';

// Called only after the consuntivi screen write permission and record scope checks.
export async function editProductionDates(session, row, body, transport = fetch) {
 const targetId=Number(body.targetId);
 if(!row.evidence.works?.some(w=>w.id===targetId))throw new Error('Lavorazione non appartenente alla produzione.');
 const actor=`workspace:${session.profile.id}`;
 async function request(path,input){
  const bytes=Buffer.from(JSON.stringify({...input,actor})),eventId=randomUUID(),timestamp=Math.floor(Date.now()/1000);
  const secret=process.env.PROGREMES_INTEGRATION_SECRET?.trim();
  if(!secret||!process.env.PROGREMES_URL)throw new Error('Collegamento MES non configurato.');
  const response=await transport(new URL(path,process.env.PROGREMES_URL),{method:'POST',body:bytes,signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',[HMAC_HEADERS.eventId]:eventId,[HMAC_HEADERS.timestamp]:String(timestamp),[HMAC_HEADERS.signature]:signProductionMessage({method:'POST',path,timestamp,eventId,body:bytes,secret})}});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Rettifica MES non disponibile.');
  return result;
 }
 const base='/api/workspace/ai/production-dates/';
 if(body.operation==='dates-read'){
  const rows=await request(base+'lookup',{query:row.evidence.orderNumber});
  const work=rows.find(w=>w.targetId===targetId&&w.before.productionOrderId===row.mes_order_id);
  if(!work)throw new Error('Lavorazione non trovata in MES.');
  return {work};
 }
 const input={targetId,expectedHash:body.expectedHash,newStartDate:body.newStartDate,newEndDate:body.newEndDate,newStartTime:body.newStartTime??null,newEndTime:body.newEndTime??null,alignBoundaryPresences:body.alignBoundaryPresences===true,reason:body.reason};
 if(body.operation==='dates-preview')return request(base+'preview',{input});
 if(body.operation!=='dates-save'||!/^[-a-f0-9]{36}$/i.test(body.requestId||''))throw new Error('Conferma non valida.');
 return request('/api/workspace/ai/actions/apply',{tool:'MES_PRODUCTION_DATES_CORRECT',target:String(targetId),input,confirmed:true,idempotencyKey:body.requestId,actionId:body.requestId,requestId:body.requestId,correlationId:body.requestId});
}

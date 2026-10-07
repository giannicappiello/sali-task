/* global process */
import { randomUUID } from 'node:crypto';
import { jsonSchema } from 'ai';
import { createProgremesProductionClient } from '../progremes-production-client.js';
import { productionSheetSession } from '../production-sheet-access.js';
import { requireCentralPrint } from '../operational-print.js';
export const productionStartSchema = {type:'object',additionalProperties:false,required:['targetId','kind','phaseId','expectedHash'],properties:{
 targetId:{type:'integer',minimum:1,maximum:2147483647},kind:{type:'string',enum:['production','packaging']},
 phaseId:{type:'string',format:'uuid'},expectedHash:{type:'string',pattern:'^[a-f0-9]{64}$'},allowShortage:{type:'boolean'}}};
const fail=message=>Object.assign(new Error(message),{status:409});
export async function authorizeStart(auth,kind) {
 const {data,error}=await auth.scoped.rpc('company_mes_ai_can_write');
 if(error || data!==true) throw Object.assign(new Error('Permesso operativo MES richiesto.'),{status:403});
 return productionSheetSession({headers:{authorization:`Bearer ${auth.token}`}},kind,{admin:auth.admin});
}
const request=(auth,input,operation)=>({externalId:randomUUID(),productionOrderId:input.targetId,kind:input.kind,phaseId:input.phaseId,operation,requestedBy:auth.profile.id});
export async function productionStartPreview(auth,input,{client=createProgremesProductionClient(),authorize=authorizeStart}={}) {
 await authorize(auth,input.kind);
 const list=(await client.batchSheet(request(auth,input,'list'))).result;
 if(!list.managed) throw fail('Produzione non gestita a batch: occorre allineare il piano prima dell’avvio.');
 const phase=list.phases?.find(row=>row.id===input.phaseId);
 if(!phase) throw fail('Batch non appartenente alla produzione selezionata.');
 if(phase.executionStatus!=='NOT_STARTED') throw fail('La lavorazione è già avviata o conclusa. Verificare lo stato.');
 const sheet=(await client.batchSheet(request(auth,input,'sheet'))).result;
 if(!/^[a-f0-9]{64}$/i.test(sheet.contentHash || '')) throw fail('Foglio produzione privo di una versione verificabile.');
 if(input.expectedHash && sheet.contentHash!==input.expectedHash) throw fail('Il foglio è cambiato: aggiornare la verifica prima dell’avvio.');
 return {targetId:input.targetId,kind:input.kind,phaseId:phase.id,expectedHash:sheet.contentHash,batch:phase.number,
  resource:phase.resource,lot:phase.lotCode,quantity:phase.quantity,unit:phase.unit,messages:sheet.messages || [],printBeforeStart:true};
}
async function complete(auth,pending,result,error=null) {
 const saved=await auth.admin.rpc('complete_workspace_external_ai_action',{p_proposal_id:pending.id,p_succeeded:result.applied===true,p_result:result,p_error:error});
 if(saved.error) throw saved.error;
 return {action:Array.isArray(saved.data)?saved.data[0]:saved.data,failure:error};
}
export async function executeProductionStart(auth,pending,{client=createProgremesProductionClient(),authorize=authorizeStart}={}) {
 const input=pending.payload_summary;
 await authorize(auth,input.kind);
 let printRequested=false;
 try {
  await productionStartPreview(auth,input,{client,authorize});
  printRequested=true;
  const result=(await client.batchSheet({...request(auth,input,'print'),externalId:pending.request_id,contentHash:input.expectedHash,
   printMode:'server',startAfterPrint:true,allowShortage:input.allowShortage===true})).result;
  requireCentralPrint(result,'print');
  const queued={applied:false,pending:true,printJobId:result.printJob.id,targetId:input.targetId,phaseId:input.phaseId,kind:input.kind};
  const saved=await auth.admin.from('ai_action_audit').update({result:queued}).eq('id',pending.id).eq('user_id',auth.profile.id)
   .eq('status','confirmed').select('*').single();
  if(saved.error) throw saved.error;
  return {action:saved.data,failure:null};
 } catch(error) {
  return complete(auth,pending,{applied:false,uncertain:printRequested},printRequested
   ? `Avvio non confermato: ${error.message} Verificare la coda stampa prima di ripetere.`
   : `Avvio non riuscito: ${error.message}`);
 }
}
export async function readStartPrintJob(id,{env=process.env,transport=fetch}={}) {
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id || '')) throw fail('Identificativo stampa non valido.');
 const url=new URL(`/api/workspace/v1/print/${id}`,env.PROGREMES_URL);
 if(url.protocol!=='https:' || !env.PROGREMES_INTEGRATION_SECRET) throw fail('Collegamento stampa MES non configurato.');
 const response=await transport(url,{redirect:'error',headers:{'X-Workspace-Secret':env.PROGREMES_INTEGRATION_SECRET},signal:AbortSignal.timeout(15000)});
 const job=await response.json();
 if(!response.ok) throw fail(job.error || job.code || 'Stato stampa non disponibile.');
 return job;
}
export async function productionStartStatus(auth,id,{client=createProgremesProductionClient(),authorize=authorizeStart,readJob=readStartPrintJob}={}) {
 const stored=await auth.scoped.from('ai_action_audit').select('*').eq('id',id).eq('user_id',auth.profile.id).maybeSingle();
 if(stored.error) throw stored.error;
 const action=stored.data;
 if(!action || action.tool!=='MES_PRODUCTION_START') throw fail('Avvio non trovato o non accessibile.');
 await authorize(auth,action.payload_summary.kind);
 if(action.status!=='confirmed' || !action.result?.printJobId) return {controlledAction:{id:action.id,tool:action.tool,state:action.status,result:action.result,error:action.error},
  answer:action.status==='executed'?(action.result?.phaseStatus==='COMPLETED'?'Produzione avviata; lavorazione già conclusa.':'Produzione avviata: in lavorazione.'):action.error || 'Avvio non ancora confermato.'};
 const job=await readJob(action.result.printJobId);
 if(job.sheet?.orderId!==action.payload_summary.targetId || job.sheet?.phaseId!==action.payload_summary.phaseId || job.sheet?.startAfterPrint!==true)
  throw fail('La stampa non corrisponde alla produzione richiesta.');
 if(job.status==='Failed' || job.confirmationError) {
  const failure=job.confirmationError || job.error || 'Stampa non riuscita.';
  const outcome=await complete(auth,action,{...action.result,pending:false,applied:false},failure);
  return {controlledAction:{id,tool:action.tool,state:outcome.action.status,result:outcome.action.result,error:failure},answer:`Avvio non riuscito: ${failure}`};
 }
 let started=false;
 let verifiedPhaseStatus;
 if(job.status==='Completed' && job.confirmedAt) {
  const list=(await client.batchSheet(request(auth,action.payload_summary,'list'))).result;
  const phase=list.phases?.find(row=>row.id===action.payload_summary.phaseId);
  verifiedPhaseStatus=phase?.executionStatus;
  started=['RUNNING','COMPLETED'].includes(verifiedPhaseStatus) && Boolean(phase.actualStart);
 }
 if(!started) return {pending:true,controlledAction:{id,tool:action.tool,state:'confirmed',result:action.result},
  answer:job.status==='Completed'?'Foglio stampato; avvio in elaborazione.':'Stampa e avvio in elaborazione.'};
 const outcome=await complete(auth,action,{...action.result,applied:true,pending:false,verified:true,phaseStatus:verifiedPhaseStatus});
 return {controlledAction:{id,tool:action.tool,state:outcome.action.status,result:outcome.action.result},answer:verifiedPhaseStatus==='COMPLETED'?'Produzione avviata; lavorazione già conclusa.':'Produzione avviata: in lavorazione.'};
}
export function productionStartTools(auth) {
 return {
 MES_PRODUCTION_START_PREVIEW:{description:'Prepara il foglio e verifica batch, impianto, lotto e versione per l’avvio richiesto. Usare gli ID letti da MES_PLAN_BATCHES. Include stampa centralizzata prima dell’avvio. Non avvia.',inputSchema:jsonSchema({type:'object',additionalProperties:false,required:['targetId','kind','phaseId'],properties:{targetId:productionStartSchema.properties.targetId,kind:productionStartSchema.properties.kind,phaseId:productionStartSchema.properties.phaseId}}),execute:input=>productionStartPreview(auth,input)},
 MES_PRODUCTION_START_STATUS:{description:'Legge stampa, conferma e stato effettivo del batch dell’avvio richiesto. Accodato non significa avviato. Nessuna ristampa o ripetizione.',inputSchema:jsonSchema({type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string',format:'uuid'}}}),execute:input=>productionStartStatus(auth,input.id)}
 };
}


/* global process */
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';
import { verifyProductionMessage } from './progremes-production-hmac.js';
export const OCT_RECONCILIATION_PATH='/api/workspace/oct-reconciliation';
export async function handleOctReconciliation(req,res,{admin,secret=process.env.PROGREMES_INTEGRATION_SECRET}={}){
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Metodo non consentito.'});
  const raw=Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body||{}));
  if(!secret||!verifyProductionMessage({method:'POST',path:OCT_RECONCILIATION_PATH,headers:req.headers,body:raw,secret}))return res.status(401).json({error:'Autenticazione MES non valida.'});
  try{
    const input=JSON.parse(raw.toString('utf8'));
    const db=admin||createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
    if(input.action==='audit'){
      const {data,error}=await db.from('workspace_oct_deletions').select('order_id,generation,payload,status,attempts,last_error').eq('status','PENDING').order('attempts').order('deleted_at').limit(200);
      if(error)throw error;
      return res.status(200).json({jobs:data||[]});
    }
    if(!['completeArchive','completeDeletion'].includes(input.action))return res.status(400).json({error:'Azione non valida.'});
    const receipt=input.receipt;
    const deletion=input.action==='completeDeletion';
    const validCounts=Number.isSafeInteger(receipt?.deletedOrders)&&receipt.deletedOrders>=0&&Number.isSafeInteger(receipt?.deletedOperations)&&receipt.deletedOperations>=0;
    if(!input.orderId||!input.generation||receipt?.workspaceOctId!==input.orderId||receipt.status!=='DELETED'||
      !validCounts||receipt.blockers?.length!==0||
      (deletion?receipt.deletedOrders+receipt.deletedOperations===0:receipt.deletedOrders!==0||receipt.deletedOperations!==0)||
      !Array.isArray(receipt.archivedOrderIds)||(!deletion&&!receipt.archivedOrderIds.length)||
      receipt.archivedOrderIds.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(receipt.archivedOrderIds).size!==receipt.archivedOrderIds.length)
      return res.status(400).json({error:'Ricevuta riconciliazione MES non valida.'});
    const {data:job,error}=await db.from('workspace_oct_deletions').select('generation,status,mes_response,payload').eq('order_id',input.orderId).single();
    if(error)throw error;
    if(job.generation!==input.generation)return res.status(409).json({error:'OCT modificato dopo la ricevuta MES: rileggere lo stato.'});
    if(job.status==='COMPLETED'){
      const stored=job.mes_response;
      if(stored?.workspaceOctId!==receipt.workspaceOctId||stored?.deletedOrders!==receipt.deletedOrders||stored?.deletedOperations!==receipt.deletedOperations||
        JSON.stringify([...(stored?.archivedOrderIds||[])].sort((a,b)=>a-b))!==JSON.stringify([...receipt.archivedOrderIds].sort((a,b)=>a-b)))
        return res.status(409).json({error:'La ricevuta non corrisponde all’archiviazione già registrata.'});
      await clarifyArchivedOctAudit(db,job,stored);
      return res.status(200).json({completed:true,alreadyCompleted:true});
    }
    if(job.status!=='PENDING')return res.status(409).json({error:'Cancellazione non più attiva.'});
    const result=await db.rpc('complete_deleted_oct',{p_order_id:input.orderId,p_generation:input.generation,p_response:receipt});
    if(result.error)throw result.error;
    if(result.data!==true)return res.status(409).json({error:'OCT cambiato durante la conferma dell’archiviazione.'});
    await clarifyArchivedOctAudit(db,job,receipt);
    return res.status(200).json({completed:true,archivedOrders:receipt.archivedOrderIds.length,deletedOrders:receipt.deletedOrders});
  }catch{return res.status(503).json({error:'Riconciliazione OCT non disponibile; riprendere la stessa richiesta.'});}
}


export async function clarifyArchivedOctAudit(db,job,receipt){
  if(!receipt?.archivedOrderIds?.length)return;
  const ids=job.payload?.rdpExternalIds||[];
  if(!ids.length)return;
  const selected=await db.from('workspace_production_requests').select('id').in('external_id',ids).eq('workspace_status','Cancelled');
  if(selected.error)throw selected.error;
  const requestIds=(selected.data||[]).map(r=>r.id);
  if(!requestIds.length)return;
  const reason='OCT eliminato in Mexal e archiviato; produzioni completate e documenti conservati.';
  const updated=await db.from('workspace_production_requests').update({cancellation_reason:reason}).in('id',requestIds).eq('workspace_status','Cancelled');
  if(updated.error)throw updated.error;
  const audit=await db.from('workspace_production_request_audit').update({action:'MEXAL_OCT_ARCHIVED',reason,details:receipt})
    .in('production_request_id',requestIds).eq('action','MEXAL_OCT_DELETED').eq('details->>workspaceOctId',receipt.workspaceOctId);
  if(audit.error)throw audit.error;
}

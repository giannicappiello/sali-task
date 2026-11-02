import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { assert } from '../shared/orderPreparation.js';
import { checked } from './order-preparation-auth.js';

export async function claimShipmentEmail(db, worker) {
  const job = checked(await db.rpc('warehouse_claim_shipment_email',{p_worker:worker}));
  if (!job) return null;
  try {
    const files = checked(await db.from('warehouse_preparation_documents').select('kind,filename,sha256,base64').eq('preparation_id',job.preparation_id).in('kind',['bcf','packing_list']));
    assert(files.length === 2, 'Allegati spedizione incompleti.');
    assert(files.reduce((size,file)=>size+file.base64.length,0)<=4000000, 'Allegati superiori al limite del servizio email (3 MB).');
    const attachments = files.map(file=>{
      const bytes=Buffer.from(file.base64,'base64');
      assert(createHash('sha256').update(bytes).digest('hex') === file.sha256, 'Integrità allegato non verificata.');
      return {filename:file.filename,content:bytes,contentType:'application/pdf'};
    });
    return {job,attachments};
  } catch(error) {
    await updateShipmentEmail(db,job,worker,'retry',error.message,true);
    throw error;
  }
}
export async function updateShipmentEmail(db, job, worker, action, message='', definitive=false) {
  return checked(await db.rpc('warehouse_update_shipment_email', {p_id:job.id,p_worker:worker,p_token:job.lock_token,p_action:action,p_message:message,p_definitive:definitive}));
}

export async function processNextShipmentEmailJob({supabase,smtp,workerId,isPermanentError=()=>false}) {
  const claimed = await claimShipmentEmail(supabase,workerId);
  if (!claimed) return {status:'idle'};
  const {job,attachments} = claimed;
  try {
    await updateShipmentEmail(supabase,job,workerId,'sending');
    const result = await smtp.send({to:job.recipient,subject:job.subject,text:job.body,attachments});
    await updateShipmentEmail(supabase,job,workerId,'complete',result.messageId || '');
    return {status:'sent',emailId:job.id};
  } catch(error) {
    await updateShipmentEmail(supabase,job,workerId,isPermanentError(error)?'failed':'retry',error.message,isPermanentError(error));
    return {status:'error',error:error.message};
  }
}

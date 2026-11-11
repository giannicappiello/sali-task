import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { POLICY_HASH,must,requireThat,buildDeliveries,recipientsFingerprint } from './commercial-policy.js';
import { loadReportRecipients,reportSettings,assertOwner } from './commercial-service.js';

// Only upgraded workers opt into this protocol. Existing order workers see no report jobs.
export async function claimCommercialEmail(db,workerId) {
  const result=must(await db.rpc('commercial_report_claim_email',{p_worker:workerId}));
  const job=Array.isArray(result)?result[0]:result;
  if(!job)return null;
  try {
    const recipients=await loadReportRecipients(db);
    const batch=must(await db.from('commercial_report_batches').select('*').eq('id',job.batch_id).single());
    requireThat(recipientsFingerprint(recipients)===batch.recipients_hash,'Collegamenti o contatti variati: richiede revisione.');
    const allFiles=must(await db.from('commercial_report_files').select('artifact_key,period,network,source,bytes,verified').eq('batch_id',job.batch_id));
    const expected=buildDeliveries(batch.period,recipients,allFiles).find(j=>j.delivery_key===job.delivery_key);
    // A change in activity, recipient or manager after generation must stop the old envelope.
    requireThat(expected&&expected.recipient===job.recipient&&expected.subject===job.subject&&JSON.stringify(expected.artifact_keys)===JSON.stringify(job.artifact_keys),'Destinatari o allegati variati dopo la generazione. Richiede revisione.');
    const files=must(await db.from('commercial_report_files').select('artifact_key,filename,bytes,sha256,verified').eq('batch_id',job.batch_id).in('artifact_key',job.artifact_keys));
    requireThat(files.length===job.artifact_keys.length&&files.every(f=>f.verified),'Allegati report incompleti.');
    return {status:'claimed',worker_id:workerId,email:{id:'report:'+job.id,lock_token:job.lock_token,destinatario:job.recipient,oggetto:job.subject,corpo:job.body},attachments:files.map(f=>({filename:f.filename,content_type:'application/pdf',report_artifact_key:f.artifact_key,sha256:f.sha256,bytes:f.bytes}))};
  } catch(error) {
    await db.from('commercial_report_emails').update({status:'failed'}).eq('id',job.id).eq('lock_token',job.lock_token);
    throw error;
  }
}
export async function commercialWorkerAction(db,body) {
  const id=String(body.email_id||'').slice(7);
  requireThat(/^[a-f0-9-]{36}$/i.test(id),'Invio report non valido.');
  const job=must(await db.from('commercial_report_emails').select('*').eq('id',id).eq('worker_id',body.worker_id).eq('lock_token',body.lock_token).maybeSingle());
  requireThat(job,'Invio report non accessibile.',403);
  const settings=await reportSettings(db);
  const batch=must(await db.from('commercial_report_batches').select('*').eq('id',job.batch_id).maybeSingle());
  requireThat(settings?.enabled&&settings.policy_hash===POLICY_HASH&&batch?.owner_id===settings.owner_id,'Piano report sospeso o modificato.',403);
  await assertOwner(db,settings.owner_id);
  if(body.action==='attachment') {
    requireThat(job.status==='uncertain'&&job.artifact_keys.includes(body.report_artifact_key),'Allegato fuori dal messaggio autorizzato.',403);
    const f=must(await db.from('commercial_report_files').select('base64,sha256,filename').eq('batch_id',job.batch_id).eq('artifact_key',body.report_artifact_key).single());
    requireThat(createHash('sha256').update(Buffer.from(f.base64,'base64')).digest('hex')===f.sha256,'Integrità allegato non valida.');
    return {filename:f.filename,base64:f.base64,sha256:f.sha256};
  }
  if(body.action==='complete') {
    if(job.status==='sent')return {status:'already_completed'};
    requireThat(job.status==='uncertain','Esito invio report inatteso.',409);
    must(await db.from('commercial_report_emails').update({status:'sent',provider_message_id:String(body.message_id||'').slice(0,200),sent_at:new Date().toISOString()}).eq('id',id).eq('status','uncertain').eq('lock_token',job.lock_token));
    const remaining=must(await db.from('commercial_report_emails').select('id').eq('batch_id',job.batch_id).neq('status','sent').limit(1));
    if(!remaining.length)must(await db.rpc('commercial_report_finish_batch',{p_batch:job.batch_id}));
    return {status:'completed'};
  }
  requireThat(body.action==='retry','Azione report non riconosciuta.');
  // Both pre-send transport loss and post-send acknowledgement loss are ambiguous.
  // Leave uncertain: a human must check the actual mail delivery before any resend.
  return {status:job.status==='sent'?'already_completed':'uncertain_requires_review'};
}

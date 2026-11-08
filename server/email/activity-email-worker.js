import { isPermanentSmtpError } from './smtp-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rpc(db, name, args) {
  const {data, error} = await db.rpc(name, args);
  // Database/provider diagnostics may contain addresses or message content.
  if (error) throw new Error('Activity email state update failed.');
  return data;
}

export async function claimActivityEmail(db, worker) {
  await rpc(db, 'workspace_expire_email_claims', {});
  const data = await rpc(db, 'workspace_claim_email', {p_worker: worker});
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function finishActivityEmail(db, job, status, messageId = null, errorCode = null) {
  const updated = await rpc(db, 'workspace_finish_email', {
    p_id: job.id, p_lock_token: job.lock_token, p_status: status,
    p_provider_message_id: messageId || null, p_error_code: errorCode,
  });
  if (updated !== true) throw new Error('Activity email claim is no longer current.');
}

export async function claimActivityForHttpWorker(db, worker) {
  // Claim is atomically sending before any payload leaves this process. Losing
  // the claim response therefore cannot cause an automatic duplicate send.
  const job = await claimActivityEmail(db, worker);
  if (!job) return null;
  return {status:'claimed', worker_id:worker, activity_email_protocol:1,
    email:{id:`activity:${job.id}`, lock_token:job.lock_token,
      destinatario:job.recipient, oggetto:job.subject, corpo:job.body}, attachments:[]};
}

export async function activityWorkerAction(db, payload) {
  const id = String(payload.email_id || '').slice('activity:'.length);
  if (payload.activity_email_protocol !== 1 || !UUID.test(id) || !UUID.test(String(payload.lock_token || ''))
      || !['accepted','failed','uncertain'].includes(payload.action)) {
    throw new Error('Invalid activity email protocol.');
  }
  const status = payload.action;
  await finishActivityEmail(db, {id,lock_token:payload.lock_token}, status,
    status === 'accepted' ? String(payload.message_id || '').slice(0,998) : null,
    status === 'failed' ? 'provider_rejected' : status === 'uncertain' ? 'transport_uncertain' : null);
  return {status};
}

export async function processNextActivityEmailJob({supabase,smtp,workerId,isPermanentError=isPermanentSmtpError}) {
  const job = await claimActivityEmail(supabase,workerId);
  if (!job) return {status:'idle'};
  let accepted = false;
  try {
    const result = await smtp.send({to:job.recipient,subject:job.subject,text:job.body,attachments:[]});
    accepted = true;
    await finishActivityEmail(supabase,job,'accepted',result.messageId);
    return {status:'accepted',emailId:job.id};
  } catch(error) {
    // Even a definitive DB failure after SMTP acceptance is not an SMTP
    // rejection. Never retry after an ambiguous handoff or acknowledgement.
    const status = !accepted && isPermanentError(error) ? 'failed' : 'uncertain';
    try {
      await finishActivityEmail(supabase,job,status,null,
        status === 'failed' ? 'provider_rejected' : 'transport_uncertain');
    } catch {
      // A lost acknowledgement can already be accepted; otherwise the sending
      // lease expires to uncertain. Do not overwrite or resend it.
    }
    return {status,emailId:job.id};
  }
}

// Read-only readiness check. Never return URLs, secrets or provider diagnostics.
export async function getActivityEmailTransport({fetchImpl=fetch,environment=globalThis.process?.env || {}}={}) {
  const url = String(environment.ARUBA_EMAIL_WORKER_URL || '').trim();
  const secret = String(environment.ARUBA_EMAIL_WORKER_SECRET || '').trim();
  if (!url || !secret) return {ready:false,status:'not_configured'};
  try {
    const capabilityUrl = new URL(url);
    if (capabilityUrl.protocol !== 'https:') return {ready:false,status:'unsupported'};
    capabilityUrl.searchParams.set('action','activity_email_capabilities');
    const response = await fetchImpl(capabilityUrl.toString(),{method:'GET',
      headers:{'X-Progre-Worker-Secret':secret},redirect:'error',signal:AbortSignal.timeout(15000)});
    if (!response.ok) return {ready:false,status:'unsupported'};
    const capability = await response.json();
    if (capability.activity_email_protocol !== 1) return {ready:false,status:'unsupported'};
    if (capability.queue_enabled !== true) return {ready:false,status:'paused'};
    return {ready:true,status:'ready'};
  } catch {
    return {ready:false,status:'unavailable'};
  }
}

export async function requireActivityEmailTransport(check=getActivityEmailTransport) {
  let transport;
  try { transport = await check(); } catch { transport = {ready:false,status:'unavailable'}; }
  if (transport?.ready !== true || transport?.status !== 'ready') {
    throw Object.assign(new Error('Servizio email non pronto. Occorre aggiornare o ripristinare il trasporto Workspace prima di autorizzare o accodare invii. La proposta non è stata modificata.'),
      {status:409,code:'EMAIL_TRANSPORT_NOT_READY'});
  }
  return transport;
}

export async function triggerActivityEmailWorker({fetchImpl=fetch,environment=globalThis.process?.env || {}}={}) {
  const transport = await getActivityEmailTransport({fetchImpl,environment});
  if (!transport.ready) return {status:transport.status};
  try {
    const sent = await fetchImpl(String(environment.ARUBA_EMAIL_WORKER_URL).trim(),{method:'POST',
      headers:{'X-Progre-Worker-Secret':String(environment.ARUBA_EMAIL_WORKER_SECRET).trim(),'Content-Type':'application/json'},
      redirect:'error',body:JSON.stringify({action:'run_activity'}),signal:AbortSignal.timeout(300000)});
    const result = await sent.json();
    if (!sent.ok || result.status !== 'ok') return {status:'uncertain'};
    return {status:'ok',accepted:Array.isArray(result.results) ? result.results.filter(item=>item.status==='accepted').length : 0};
  } catch {
    return {status:'uncertain'};
  }
}

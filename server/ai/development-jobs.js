/* global process */
import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { jsonSchema } from 'ai';
import { generateDevelopmentChange } from './development-agent.js';
import { resolveUiSourceContext } from './ui-source-context.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const canDevelop = auth => auth.profile?.ruoli?.amministratore_workspace === true;
const hash = value => createHash('sha256').update(value).digest('hex');
const fields = 'id,user_id,conversation_id,repository,instruction,status,created_at,approved_at,finished_at,host_id,result,error,publish_requested,source_job_id';

export function validateDevelopmentResult(result, baseCommit) {
  if (!result || result.baseCommit !== baseCommit || !/^[a-f0-9]{40}$/.test(baseCommit || '') || result.published !== false)
    throw fail('Esito non legato alla revisione autorizzata.');
  if (!Array.isArray(result.checks) || !result.checks.length || result.checks.some(check => check.succeeded !== true))
    throw fail('Mancano verifiche riuscite.');
  if (!Array.isArray(result.edits) || !result.edits.length || !/^codex\/ai-[a-f0-9-]{36}$/.test(result.revision?.branch || '') || !/^[a-f0-9]{40}$/.test(result.revision?.commit || '') || result.revision?.published !== false)
    throw fail('Manca una revisione verificabile delle modifiche.');
}

export function validatePublishedResult(result, job) {
  validateDevelopmentResult({ ...result, published: false }, job.source_commit);
  if (!job.publish_requested || result.published !== true || result.publication?.mainCommit !== result.revision.commit || result.publication?.branch !== 'main') throw fail('Pubblicazione non autorizzata o commit non verificato.');
  if (job.repository === 'workspace' && (result.publication.stage !== 'production_ready' || result.publication.deploymentState !== 'READY' || result.publication.productionUrl !== 'https://workspace.progre.it')) throw fail('Produzione Workspace non verificata.');
  if (job.repository === 'mes' && (result.publication.stage !== 'main_published' || result.publication.serverUpdateRequired !== true)) throw fail('Pubblicazione MES non verificata.');
}

export async function requestDevelopmentJob(auth, input) {
  if (!canDevelop(auth)) throw fail('Sviluppo del codice riservato agli amministratori Workspace.', 403);
  const instruction = String(input.instruction || '').trim();
  if (!['workspace', 'mes'].includes(input.repository) || instruction.length < 10 || instruction.length > 12000) throw fail('Repository o richiesta non validi.');
  const { data, error } = await auth.admin.from('ai_development_jobs').insert({
    user_id: auth.profile.id, conversation_id: auth.conversationId || null, repository: input.repository, instruction,
    status: 'queued', approved_at: new Date().toISOString(), publish_requested: input.publish !== false,
    ...(auth.screenContext ? { result: { requestContext: resolveUiSourceContext(auth.screenContext) } } : {}),
  }).select(fields).single();
  if (error) throw error;
  return { changed: false, requiresConfirmation: false, developmentJob: data,
    message: input.publish === false ? 'Modifica e test accodati, senza pubblicazione come richiesto.' : 'Modifica, test e pubblicazione su main accodati al servizio sul PC. Workspace sarà dichiarato pubblicato solo dopo verifica della produzione; per MES resterà da aggiornare il server. Non dichiarare completato prima dell’esito.' };
}

export async function requestDevelopmentPublication(auth, id) {
  if (!canDevelop(auth)) throw fail('Accesso amministrativo richiesto.', 403);
  const { data: source, error } = await auth.admin.from('ai_development_jobs').select('*').eq('id', id).eq('user_id', auth.profile.id).maybeSingle();
  if (error) throw error;
  if (!source || !['review', 'failed', 'interrupted'].includes(source.status) || !source.result?.revision) throw fail('Lavoro verificato non disponibile per la pubblicazione.', 409);
  validateDevelopmentResult(source.result, source.source_commit);
  const { data: existing, error: lookupError } = await auth.admin.from('ai_development_jobs').select(fields).eq('source_job_id', id).eq('user_id', auth.profile.id).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return { developmentJob: existing, changed: false, message: 'Pubblicazione già richiesta: verificare questo lavoro, senza duplicarlo.' };
  const { data, error: insertError } = await auth.admin.from('ai_development_jobs').insert({
    user_id: auth.profile.id, conversation_id: auth.conversationId || source.conversation_id || null, repository: source.repository, instruction: `Pubblica il lavoro verificato ${source.id} su main e verifica la produzione.`,
    source_job_id: source.id, source_commit: source.source_commit, result: source.result, publish_requested: true,
    status: 'queued', approved_at: new Date().toISOString(),
  }).select(fields).single();
  if (insertError) throw insertError;
  return { developmentJob: data, changed: false, message: 'Pubblicazione accodata. Nessuna nuova elaborazione del codice; il servizio verificherà commit remoto e produzione.' };
}

export function developmentTools(auth) {
  if (!canDevelop(auth)) return {};
  return { CODE_LOCATE_UI: {
    description: 'Identifica il popup o la schermata aperta e i componenti candidati nel repository. I popup interni non hanno necessariamente un URL autonomo: non chiederlo. Usa questa lettura prima di una modifica UI se il componente non è chiaro; i file vanno verificati nella revisione corrente dal servizio di sviluppo.',
    inputSchema: jsonSchema({ type: 'object', additionalProperties: false, properties: {} }),
    execute: () => ({ target: resolveUiSourceContext(auth.screenContext), changed: false }),
  }, CODE_PUBLISH_REQUEST: {
    description: 'Pubblica su main un lavoro già testato quando l’admin chiede il rilascio. Verifica Workspace in produzione; per MES pubblica i sorgenti e segnala di aggiornare il server. Non ripetere se un lavoro di pubblicazione è già in corso.',
    inputSchema: jsonSchema({ type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }), execute: input => requestDevelopmentPublication(auth, input.id),
  }, CODE_JOB_LIST: {
    description: 'Legge gli ultimi lavori di sviluppo del richiedente con stato ed esito. Usare per ritrovare un lavoro senza crearne un duplicato. queued/running non significa completato; review significa testato ma non pubblicato.',
    inputSchema: jsonSchema({ type: 'object', additionalProperties: false, properties: {} }),
    execute: () => readDevelopmentJobs(auth),
  }, CODE_JOB_STATUS: {
    description: 'Legge il risultato persistito di uno specifico lavoro di sviluppo del richiedente: verifiche, commit, errori e stato effettivo. Non avvia né pubblica il lavoro.',
    inputSchema: jsonSchema({ type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }),
    execute: input => readDevelopmentJobs(auth, input.id),
  }, CODE_CHANGE_REQUEST: {
    description: 'Avvia modifica, test isolati e pubblicazione su main per una richiesta esplicita dell’amministratore. Non chiedere un’altra conferma nelle Impostazioni AI. Usare publish=false se chiede solo una modifica locale o di non pubblicare. Non usare per sole analisi, proposte o richieste di non modificare. Workspace viene verificato su Vercel; per MES il server richiede aggiornamento dell’utente. Attendere CODE_JOB_STATUS prima di dichiarare completato.',
    inputSchema: jsonSchema({ type: 'object', additionalProperties: false, required: ['repository', 'instruction'], properties: {
      repository: { type: 'string', enum: ['workspace', 'mes'] }, instruction: { type: 'string', minLength: 10, maxLength: 12000 }, publish: { type: 'boolean', description: 'Predefinito true. False solo se il richiedente esclude la pubblicazione o richiede una bozza locale.' },
    } }), execute: input => requestDevelopmentJob(auth, input),
  } };
}

export async function readDevelopmentJobs(auth, id) {
  if (!canDevelop(auth)) throw fail('Accesso amministrativo richiesto.', 403);
  let query = auth.admin.from('ai_development_jobs').select(fields).eq('user_id', auth.profile.id);
  query = id ? query.eq('id', id).maybeSingle() : query.order('created_at', { ascending: false }).limit(10);
  const { data, error } = await query;
  if (error) throw error;
  if (id && !data) throw fail('Lavoro non trovato o non accessibile.', 404);
  const summarize = job => ({ ...job, result: job.result ? {
    baseCommit: job.result.baseCommit, summary: job.result.summary, revision: job.result.revision,
    published: job.result.published === true, publication: job.result.publication,
    edits: (job.result.edits || []).map(edit => ({ path: edit.path })),
    checks: (job.result.checks || []).map(check => ({ ...check, output: String(check.output || '').slice(-4000) })),
  } : null });
  return { changed: false, readAt: new Date().toISOString(), ...(id ? { job: summarize(data) } : { jobs: (data || []).map(summarize) }) };
}

export async function handleDevelopmentSettings(auth, body) {
  if (!canDevelop(auth)) throw fail('Accesso amministrativo richiesto.', 403);
  if (body.action === 'development_list') {
    const [hosts, jobs] = await Promise.all([
      auth.admin.from('ai_development_hosts').select('id,name,active,last_seen_at,diagnostics').order('created_at', { ascending: false }),
      auth.admin.from('ai_development_jobs').select(fields).order('created_at', { ascending: false }).limit(50),
    ]);
    if (hosts.error || jobs.error) throw hosts.error || jobs.error;
    return { hosts: hosts.data, jobs: jobs.data };
  }
  if (body.action === 'development_pair') {
    const token = randomBytes(32).toString('hex');
    const { data, error } = await auth.admin.from('ai_development_hosts').insert({
      name: 'PC AssistenteAI', token_hash: hash(token), created_by: auth.profile.id,
    }).select('id,name').single();
    if (error) throw error;
    return { host: data, token, message: 'Credenziale mostrata una sola volta. Conservarla soltanto nella configurazione protetta del servizio sul PC.' };
  }
  if (body.action === 'development_revoke') {
    const { error } = await auth.admin.from('ai_development_hosts').update({ active: false }).eq('id', body.hostId);
    if (error) throw error;
    return { revoked: true };
  }
  if (body.action === 'development_decide') {
    if (!['confirm', 'reject'].includes(body.decision)) throw fail('Decisione non valida.');
    const { data, error } = await auth.admin.from('ai_development_jobs').update({
      status: body.decision === 'confirm' ? 'queued' : 'rejected', approved_at: new Date().toISOString(),
    }).eq('id', body.jobId).eq('user_id', auth.profile.id).eq('status', 'proposed').select(fields).maybeSingle();
    if (error) throw error;
    if (!data) throw fail('Lavoro già gestito o appartenente a un altro amministratore.', 409);
    return { job: data };
  }
  if (body.action === 'development_request') return requestDevelopmentJob(auth, body);
  if (body.action === 'development_publish') return requestDevelopmentPublication(auth, body.jobId);
  if (body.action === 'development_status') return readDevelopmentJobs(auth, body.jobId);
  throw fail('Operazione di sviluppo non disponibile.');
}

export async function handleDevelopmentWorker(req) {
  if (req.method !== 'POST') throw fail('Metodo non consentito.', 405);
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!/^[a-f0-9]{64}$/.test(token)) throw fail('Identità worker non valida.', 401);
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: host, error } = await admin.from('ai_development_hosts').select('id').eq('token_hash', hash(token)).eq('active', true).maybeSingle();
  if (error) throw error;
  if (!host) throw fail('Worker revocato o non associato.', 401);
  const body = req.body || {};
  const heartbeat = await admin.from('ai_development_hosts').update({ last_seen_at: new Date().toISOString() }).eq('id', host.id);
  if (heartbeat.error) throw heartbeat.error;
  if (body.action === 'claim') {
    const { data, error: claimError } = await admin.rpc('claim_ai_development_job', { p_host_id: host.id });
    if (claimError) throw claimError;
    return { job: data?.[0] || null };
  }
  if (!['heartbeat', 'finish', 'generate', 'checkpoint'].includes(body.action)) throw fail('Operazione worker non valida.');
  const { data: current, error: currentError } = await admin.from('ai_development_jobs').select('*')
    .eq('id', body.jobId).eq('host_id', host.id).eq('lease_token', body.leaseToken).eq('status', 'running')
    .gt('lease_until', new Date().toISOString()).maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw fail('Sessione worker scaduta o lavoro non assegnato.', 409);
  const { data: owner, error: ownerError } = await admin.from('utenti').select('attivo,ruoli(amministratore_workspace)').eq('id', current.user_id).maybeSingle();
  if (ownerError) throw ownerError;
  if (!owner?.attivo || owner.ruoli?.amministratore_workspace !== true) throw fail('Autorizzazione del richiedente revocata.', 403);
  if (body.action === 'generate') {
    const { data: reserved, error: reserveError } = await admin.rpc('reserve_ai_development_generation', {
      p_job_id: current.id, p_host_id: host.id, p_lease_token: body.leaseToken, p_commit: body.source?.baseCommit,
    });
    if (reserveError) throw reserveError;
    if (!reserved?.length) throw fail('Limite di elaborazioni raggiunto, revisione cambiata o autorizzazione revocata.', 409);
    const result = await generateDevelopmentChange(admin, current, body.source || {});
    return result;
  }
  if (body.action === 'checkpoint') {
    if (!current.publish_requested) throw fail('Pubblicazione non richiesta.', 403);
    validateDevelopmentResult(body.result, current.source_commit);
  }
  if (body.action === 'finish' && body.succeeded === true) {
    if (body.result?.published === true) validatePublishedResult(body.result, current);
    else validateDevelopmentResult(body.result, current.source_commit);
  }
  const update = body.action === 'heartbeat' ? { lease_until: new Date(Date.now() + 300000).toISOString() } : body.action === 'checkpoint' ? { result: body.result, lease_until: new Date(Date.now() + 300000).toISOString() } : {
    status: body.succeeded === true ? (body.result?.published === true ? 'published' : 'review') : 'failed', finished_at: new Date().toISOString(),
    result: body.result || current.result || {}, error: body.succeeded === true ? null : String(body.error || 'Verifica non riuscita.').slice(0, 2000),
  };
  if (update.result && current.result?.requestContext) update.result = { ...update.result, requestContext: current.result.requestContext };
  if (JSON.stringify(update).length > 2000000) throw fail('Risultato troppo grande.', 413);
  const { data, error: updateError } = await admin.from('ai_development_jobs').update(update)
    .eq('id', body.jobId).eq('host_id', host.id).eq('lease_token', body.leaseToken).eq('status', 'running')
    .gt('lease_until', new Date().toISOString()).select('id,status').maybeSingle();
  if (updateError) throw updateError;
  if (!data) throw fail('Sessione worker scaduta o lavoro non assegnato.', 409);
  return { job: data };
}

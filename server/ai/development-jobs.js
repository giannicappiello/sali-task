/* global process */
import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { jsonSchema } from 'ai';
import { generateDevelopmentChange } from './development-agent.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const canDevelop = auth => auth.profile?.ruoli?.amministratore_workspace === true;
const hash = value => createHash('sha256').update(value).digest('hex');
const fields = 'id,user_id,conversation_id,repository,instruction,status,created_at,approved_at,finished_at,host_id,result,error';

export function validateDevelopmentResult(result, baseCommit) {
  if (!result || result.baseCommit !== baseCommit || !/^[a-f0-9]{40}$/.test(baseCommit || '') || result.published !== false)
    throw fail('Esito non legato alla revisione autorizzata.');
  if (!Array.isArray(result.checks) || !result.checks.length || result.checks.some(check => check.succeeded !== true))
    throw fail('Mancano verifiche riuscite.');
  if (!Array.isArray(result.edits) || !result.edits.length || !/^codex\/ai-[a-f0-9-]{36}$/.test(result.revision?.branch || '') || !/^[a-f0-9]{40}$/.test(result.revision?.commit || '') || result.revision?.published !== false)
    throw fail('Manca una revisione verificabile delle modifiche.');
}

export async function requestDevelopmentJob(auth, input) {
  if (!canDevelop(auth)) throw fail('Sviluppo del codice riservato agli amministratori Workspace.', 403);
  const instruction = String(input.instruction || '').trim();
  if (!['workspace', 'mes'].includes(input.repository) || instruction.length < 10 || instruction.length > 12000) throw fail('Repository o richiesta non validi.');
  const { data, error } = await auth.admin.from('ai_development_jobs').insert({
    user_id: auth.profile.id, repository: input.repository, instruction,
    status: 'queued', approved_at: new Date().toISOString(),
  }).select(fields).single();
  if (error) throw error;
  return { changed: false, requiresConfirmation: false, developmentJob: data,
    message: 'Richiesta autorizzata dall’amministratore e messa in coda al servizio sul PC per modifica e test isolati. Non serve una seconda conferma nelle Impostazioni AI. Il codice non è ancora modificato: l’esito dipende dall’elaborazione. Il risultato sarà da revisionare, senza pubblicazione automatica.' };
}

export function developmentTools(auth) {
  if (!canDevelop(auth)) return {};
  return { CODE_CHANGE_REQUEST: {
    description: 'Avvia in coda un lavoro di sviluppo isolato per correggere codice, funzioni o schermate Workspace/MES quando l’amministratore chiede esplicitamente di effettuare la modifica. La richiesta esplicita autorizza modifica e test: non chiedere una seconda conferma nelle Impostazioni AI. Non usare per sole analisi, proposte o richieste di non modificare. Non pubblica né modifica dati di produzione; attendere l’esito prima di dichiarare il lavoro completato.',
    inputSchema: jsonSchema({ type: 'object', additionalProperties: false, required: ['repository', 'instruction'], properties: {
      repository: { type: 'string', enum: ['workspace', 'mes'] }, instruction: { type: 'string', minLength: 10, maxLength: 12000 },
    } }), execute: input => requestDevelopmentJob(auth, input),
  } };
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
  if (!['heartbeat', 'finish', 'generate'].includes(body.action)) throw fail('Operazione worker non valida.');
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
  if (body.action === 'finish' && body.succeeded === true) validateDevelopmentResult(body.result, current.source_commit);
  const update = body.action === 'heartbeat' ? { lease_until: new Date(Date.now() + 300000).toISOString() } : {
    status: body.succeeded === true ? 'review' : 'failed', finished_at: new Date().toISOString(),
    result: body.result || {}, error: body.succeeded === true ? null : String(body.error || 'Verifica non riuscita.').slice(0, 2000),
  };
  if (JSON.stringify(update).length > 2000000) throw fail('Risultato troppo grande.', 413);
  const { data, error: updateError } = await admin.from('ai_development_jobs').update(update)
    .eq('id', body.jobId).eq('host_id', host.id).eq('lease_token', body.leaseToken).eq('status', 'running')
    .gt('lease_until', new Date().toISOString()).select('id,status').maybeSingle();
  if (updateError) throw updateError;
  if (!data) throw fail('Sessione worker scaduta o lavoro non assegnato.', 409);
  return { job: data };
}

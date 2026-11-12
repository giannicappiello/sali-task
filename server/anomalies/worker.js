import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { createProgremesReadonlyAdmin } from '../progremes-readonly-auth.js';
import { businessWindow, evaluatePlanning } from './engine.js';
const must = r => { if (r.error) throw r.error; return r.data; };
const log = (level, message, metadata = {}) => { try { console[level](message, metadata); } catch { /* Logging must never affect the control run. */ } };

export async function loadDailySnapshot({ db = createProgremesReadonlyAdmin(), now = new Date(), ownerId = process.env.FABBISOGNI_OWNER_PROFILE_ID } = {}) {
 const { collectControlSnapshot } = await import('./sources.js');
 return collectControlSnapshot(db, ownerId, { now });
}

async function deliverPersistedRun(db,{agent,run,window,findings,coverage,departmentIds,ownerId}){
 try{
  const {dispatchAnomalyEmails,enqueueAnomalyEmails}=await import('./delivery.js');
  const queued=await enqueueAnomalyEmails(db,{actorId:ownerId,run,window,findings,coverage,departmentIds,policy:agent.recipient_policy});
  let dispatch=null;
  try{dispatch=await dispatchAnomalyEmails();}catch(error){dispatch={status:'requires_review',code:error.code||'dispatch_error'};log('error','Anomaly email dispatch requires review',{code:error.code||'dispatch_error'});}
  const rows=must(await db.from('anomaly_deliveries').select('status').eq('run_id',run.id).eq('channel','email'));
  const counts=rows.reduce((out,row)=>({...out,[row.status]:(out[row.status]||0)+1}),{});
  const status=(counts.uncertain||counts.failed)?'requires_review':(counts.pending?'pending':(counts.accepted||counts.delivered?'accepted':(rows.length?'complete':'no_recipients')));
  return {status,queued:queued.queued,dispatch,deliveries:counts};
 }catch(error){log('error','Anomaly report email was not queued',{code:error.code||'delivery_error',message:String(error.message||'').slice(0,300),runId:run.id,bodyChars:error.bodyChars,maxChars:error.maxChars});return {status:'blocked',reason:error.code||'delivery_not_ready'};}
}

export async function runDaily(db, { now = new Date(), loadSnapshot, ownerId = process.env.FABBISOGNI_OWNER_PROFILE_ID } = {}) {
 const window = businessWindow(now);
 if (!window.due) return { status: 'outside_schedule', timezone: 'Europe/Rome' };
 const agent = must(await db.from('anomaly_agents').select('*').eq('code', 'fabbisogni').single());
 if (!agent.enabled) return { status: 'disabled', readiness: agent.readiness };
 if (agent.readiness?.ready !== true) return { status: 'blocked', reason: 'Readiness has not been verified and approved. No findings, email or management changes produced.' };
 const existing = must(await db.from('anomaly_runs').select('id,status,business_day,coverage').eq('agent_code', agent.code).eq('business_day', window.from).maybeSingle());
 if (existing) {
  let delivery='not_sent';
  if(agent.readiness?.ready===true&&agent.readiness?.emailReady===true){
   const findings=must(await db.from('anomalies').select('*').eq('last_run_id',existing.id));
   const stored=existing.coverage||{};
   delivery=await deliverPersistedRun(db,{agent,run:existing,window,findings,coverage:stored.sources||{},departmentIds:stored.departmentIds||[...new Set(findings.map(x=>x.department_id).filter(Boolean))],ownerId});
  }
  return { status: 'already_recorded', run: existing, delivery };
 }
 // Snapshot collection is read-only. Only the final atomic RPC persists findings.
 const snapshot = await (loadSnapshot || (() => loadDailySnapshot({ db, now, ownerId })))({ from: window.from, toExclusive: window.toExclusive, yesterday: window.yesterday });
 // The production adapter already evaluates the MES purchasing contract. Running
 // the legacy normalized-input evaluator again would silently discard its findings.
 const result = snapshot.kind === 'analyzed-control-source' ? snapshot : evaluatePlanning(snapshot, now);
 if (result.window.from !== window.from || result.window.toExclusive !== window.toExclusive || !Array.isArray(result.findings) || !Array.isArray(result.gaps)) throw Error('Invalid daily analysis contract');
 const persisted = must(await db.rpc('anomaly_record_run', { p_day: window.from, p_status: result.status, p_coverage: { gaps: result.gaps, window: result.window, sources: snapshot.coverage, departmentIds:snapshot.departmentIds||[] }, p_findings: result.findings }));
 const delivery=agent.enabled&&agent.readiness?.emailReady===true?await deliverPersistedRun(db,{agent,run:persisted,window,findings:result.findings,coverage:snapshot.coverage,departmentIds:snapshot.departmentIds||[],ownerId}):'not_sent';
 return { status: result.status, run: persisted, delivery:delivery.status==='not_configured'?'not_sent':delivery, findingCount:result.findings.length, gapCount:result.gaps.length };
}

// Explicit recovery of today's persisted run, not a second analysis or a clock override.
export async function recoverAnomalyRun(db, {runId, now = new Date(), ownerId = process.env.FABBISOGNI_OWNER_PROFILE_ID} = {}) {
 if (!/^[a-f0-9-]{36}$/i.test(String(runId || ''))) return {status:'blocked',reason:'INVALID_RUN_ID'};
 const window = businessWindow(now);
 const agent = must(await db.from('anomaly_agents').select('*').eq('code','fabbisogni').single());
 if (!agent.enabled || agent.readiness?.ready !== true || agent.readiness?.emailReady !== true) return {status:'blocked',reason:'EMAIL_DELIVERY_NOT_READY'};
 const run = must(await db.from('anomaly_runs').select('id,agent_code,business_day,status,coverage').eq('id',runId).maybeSingle());
 if (!run || run.agent_code !== 'fabbisogni' || run.business_day !== window.from || !['complete','incomplete'].includes(run.status)) return {status:'blocked',reason:'TODAYS_PERSISTED_RUN_REQUIRED'};
 // The Aruba anomaly worker drains a global anomaly queue. Stop rather than
 // sending another day's mail or silently retrying an ambiguous transport.
 const deliveries = must(await db.from('anomaly_deliveries').select('run_id,status').eq('channel','email').in('status',['pending','uncertain','failed']));
 if (deliveries.some(row => row.run_id !== run.id && row.status === 'pending')) return {status:'blocked',reason:'OTHER_RUN_PENDING'};
 if (deliveries.some(row => row.run_id === run.id && ['uncertain','failed'].includes(row.status))) return {status:'blocked',reason:'DELIVERY_REQUIRES_REVIEW'};
 const findings = must(await db.from('anomalies').select('*').eq('last_run_id',run.id));
 const stored = run.coverage || {};
 return {status:'recovery',runId:run.id,delivery:await deliverPersistedRun(db,{agent,run,window,findings,coverage:stored.sources||{},departmentIds:stored.departmentIds||[],ownerId})};
}

export async function handleAnomalyCron(req, res, { env = globalThis.process.env, admin = createProgremesReadonlyAdmin, ...dependencies } = {}) {
 res.setHeader('Cache-Control', 'no-store');
 const expected = String(env.CRON_SECRET || ''), actual = String(req.headers?.authorization || '').replace(/^Bearer /, '');
 const recovery = req.method === 'POST' && req.body?.action === 'recover_delivery';
 if (req.method !== 'GET' && !recovery) return res.status(405).json({ error: 'Metodo non consentito.' });
 if (!expected || expected.length !== actual.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) return res.status(401).json({ error: 'Cron non autorizzato.' });
 try {
  const db = admin();
  const now = dependencies.now || new Date();
  if (recovery) return res.json(await recoverAnomalyRun(db,{runId:req.body.run_id,now,ownerId:env.FABBISOGNI_OWNER_PROFILE_ID}));
  const loadSnapshot = dependencies.loadSnapshot || (() => loadDailySnapshot({ db, now, ownerId: env.FABBISOGNI_OWNER_PROFILE_ID }));
  return res.json(await runDaily(db, { ...dependencies, now, ownerId: env.FABBISOGNI_OWNER_PROFILE_ID, loadSnapshot }));
 }
 catch { return res.status(503).json({ status: 'failed', error: 'Controllo non concluso. Verificare il run persistito prima di ripetere.' }); }
}

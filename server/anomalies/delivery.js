import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { resolveRecipients } from './recipients.js';
import { allowsAnomalyDepartmentManager } from '../../shared/anomalyRecipientDepartments.js';

const must = r => { if (r.error) throw r.error; return r.data; };
const hash = value => createHash('sha256').update(value).digest('hex');

// Keep well below the database's 20,000-character contract, including the
// recipient scope suffix. Details remain intact in the authorized registry.
export const ANOMALY_EMAIL_MAX_CHARS = 20000;
const excerpt = (value, limit = 240) => {
 const chars = Array.from(String(value ?? '').replace(/\s+/g, ' ').trim());
 return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : chars.join('');
};
const severityRank = value => ({critical: 0, high: 1, warning: 2, info: 3}[value] ?? 4);
const findingKey = x => String(x.fingerprint || `${x.title}|${x.description}|${x.evidence?.jobId ?? ''}|${x.evidence?.article ?? ''}`);
const compareFindings = (a, b) => severityRank(a.severity) - severityRank(b.severity) || findingKey(a).localeCompare(findingKey(b));
const findingLine = (x, i) => {
 const detail = x.description && x.description !== x.title ? ` — ${excerpt(x.description)}` : '';
 const evidence = [x.evidence?.jobId != null ? `lavorazione ${excerpt(x.evidence.jobId, 40)}` : '', x.evidence?.article ? `articolo ${excerpt(x.evidence.article, 80)}` : '', x.evidence?.shortage != null ? `carenza ${excerpt(x.evidence.shortage, 40)} ${excerpt(x.evidence.unit, 20)}` : ''].filter(Boolean).join(', ');
 return `${i + 1}. [${excerpt(x.severity, 20).toUpperCase()}] ${excerpt(x.title)}${detail}${evidence ? ` (${evidence})` : ''}`;
};

export function anomalyEmail({ day, window, findings, coverage, runUrl }) {
 const ordered = [...findings].sort(compareFindings);
 const critical = ordered.filter(x => ['critical','high'].includes(x.severity));
 const other = ordered.filter(x => !['critical','high'].includes(x.severity));
 const gaps = Object.entries(coverage || {}).filter(([,v]) => v?.complete !== true).sort(([a],[b]) => a.localeCompare(b));
 const selectedCritical = critical.slice(0, 10), selectedOther = other.slice(0, 5), selectedGaps = gaps.slice(0, 12);
 const lines = [
  `Controllo Fabbisogni & Planning — ${day}`,
  `Orizzonte: ${window.from} → ${window.toExclusive} (termine escluso), Europe/Rome.`,
  `Esito: ${gaps.length ? 'INCOMPLETO — le fonti mancanti non equivalgono a esito regolare' : 'copertura completa'}.`,
  `Segnalazioni totali: ${findings.length}. Criticità alte/critiche: ${critical.length}; altre segnalazioni: ${other.length}.`,
  'Sintesi email: estratti delle principali segnalazioni, priorità alle criticità. Testi e prove integrali restano nel registro Workspace.',
  '', `CRITICITÀ PRINCIPALI (${selectedCritical.length} di ${critical.length})`,
  ...(critical.length ? selectedCritical.map(findingLine) : ['Nessuna criticità alta/critica rilevata nelle fonti complete.']),
  '', `ALTRE SEGNALAZIONI (${selectedOther.length} di ${other.length})`,
  ...(other.length ? selectedOther.map(findingLine) : ['Nessuna.']),
  '', `COPERTURA E LIMITI (${selectedGaps.length} di ${gaps.length} lacune)`,
  ...(gaps.length ? selectedGaps.map(([name,value]) => `• ${excerpt(name, 80)}: ${excerpt(value?.reason || 'copertura non verificata', 300)}`) : ['Fonti richieste complete secondo il contratto di controllo.']),
  'Le differenze fisiche non confrontabili o con cutoff di sincronizzazione non attestato sono riportate come da verificare, non come errori contabili.',
  '', `Elenco completo nel registro anomalie e relative prove (visibilità secondo permessi Workspace): ${runUrl}`,
  'Il report è deterministico e in sola lettura. Nessun ordine, prenotazione, lotto o cambio planning viene eseguito automaticamente.',
 ].join('\n');
 return { subject: `Progre — Fabbisogni & Planning ${day}${gaps.length ? ' · copertura incompleta' : ''}`, body: lines };
}

export async function authorizedRecipients(db, policy, departmentIds) {
 const [usersResult, membershipResult] = await Promise.all([
  db.from('utenti').select('id,nome,cognome,email,attivo,responsabile_utente_id,ruoli(amministratore_workspace)').eq('attivo',true),
  db.from('utenti_reparti').select('utente_id,reparto_id'),
 ]);
 const users = must(usersResult), memberships = must(membershipResult);
 const departments = policy.departmentManager
  ? must(await db.from('reparti').select('id,nome')) : [];
 const excludedManagerIds = new Set(departments.filter(dept => !allowsAnomalyDepartmentManager(dept)).map(dept => dept.id));
 const byUser = new Map();
 const globalAdminPolicy={...policy,departmentManager:false,departmentOverrides:{},additionalUserIds:[]};
 const globalAdmins=resolveRecipients({departmentId:null,policy:globalAdminPolicy,users,memberships});
 if(policy.workspaceAdmins&&!globalAdmins.ready)throw Object.assign(Error('Destinatari amministrativi mancanti o ambigui.'),{code:'RECIPIENTS_NOT_READY',gaps:globalAdmins.gaps});
 for(const person of globalAdmins.recipients)byUser.set(person.userId,{...person,departmentIds:null});
 for (const departmentId of departmentIds) {
  const departmentManager = policy.departmentManager && !excludedManagerIds.has(departmentId);
  if(!departmentManager&&!(policy.additionalUserIds||[]).length)continue;
  const managerPolicy={...policy,departmentManager,workspaceAdmins:false,additionalUserIds:policy.additionalUserIds||[]};
  const resolved = resolveRecipients({ departmentId, policy:managerPolicy, users, memberships });
  if (!resolved.ready) throw Object.assign(Error('Destinatari mancanti o ambigui.'), { code:'RECIPIENTS_NOT_READY', gaps:resolved.gaps });
  for (const person of resolved.recipients) {
   const existing=byUser.get(person.userId);
   if(existing?.departmentIds===null)continue;
   const scoped=existing||{...person,departmentIds:[]};
   if(!scoped.departmentIds.includes(departmentId))scoped.departmentIds.push(departmentId);
   byUser.set(person.userId,scoped);
  }
 }
 const result=[...byUser.values()],ids=result.map(x=>x.userId);
 if(!result.length)throw Object.assign(Error('Nessun destinatario configurato.'),{code:'RECIPIENTS_NOT_READY'});
 const addresses=new Set();for(const p of result){const email=p.email.toLowerCase();if(addresses.has(email))throw Object.assign(Error('Indirizzo email condiviso da identità diverse; configurazione destinatari ambigua.'),{code:'DUPLICATE_RECIPIENT_ADDRESS'});addresses.add(email);}
 if(ids.length){
  const access=must(await db.from('utenti').select('id,auth_user_id,attivo').in('id',ids));
  const authorized=[];
  for(const person of result){const user=access.find(x=>x.id===person.userId);if(!user?.auth_user_id||user.attivo!==true)continue;
   const area=must(await db.rpc('workspace_area_access_codes',{target_auth_user_id:user.auth_user_id}));
   if(!Array.isArray(area)||!area.includes('anomalie'))continue;
   let permitted=true;for(const module of ['anomalie','progremes','magazzino'])if(must(await db.rpc('workspace_module_enabled_for_user',{target_user_id:user.id,target_module:module}))!==true)permitted=false;
   if(permitted)authorized.push(person);
  }
  if(authorized.length!==result.length)throw Object.assign(Error('Il perimetro dei destinatari deve includere Anomalie, ProgreMES e Magazzino.'),{code:'RECIPIENT_SOURCE_ACCESS_MISSING'});
 }
 return result;
}

export function buildEmailJobs({ recipients, day, window, findings, coverage, runUrl }) {
 const unique = new Map();
 for (const recipient of recipients) unique.set(recipient.userId, recipient);
 return [...unique.values()].map(recipient => {
  const scopedFindings=Array.isArray(recipient.departmentIds)?findings.filter(x=>x.department_id&&recipient.departmentIds.includes(x.department_id)):findings;
  const content = anomalyEmail({day,window,findings:scopedFindings,coverage,runUrl});
  const body = `${content.body}\n\nAmbito destinatario: ${Array.isArray(recipient.departmentIds) ? 'reparti assegnati' : 'amministrazione Workspace'}.`;
  if (Array.from(body).length > ANOMALY_EMAIL_MAX_CHARS) throw Object.assign(Error('Sintesi email oltre il limite consentito.'), {code:'ANOMALY_EMAIL_BODY_TOO_LONG', bodyChars:Array.from(body).length, maxChars:ANOMALY_EMAIL_MAX_CHARS});
  return { recipient_id:recipient.userId, recipient_email:recipient.email, scope_department_ids:recipient.departmentIds, channel:'email', subject:content.subject, body, content_hash:hash(JSON.stringify({day,body,recipient:recipient.userId})) };
 });
}

export async function enqueueAnomalyEmails(db, { actorId, run, window, findings, coverage, departmentIds, policy }) {
 if(!/^[a-f0-9-]{36}$/i.test(String(actorId||'')))throw Object.assign(Error('Titolare pianificato non configurato.'),{code:'SCHEDULED_OWNER_NOT_CONFIGURED'});
 const departments = [...new Set(departmentIds||findings.map(x => x.department_id).filter(Boolean))];
 if(findings.some(x=>!x.department_id)&&!policy.workspaceAdmins)throw Object.assign(Error('Le segnalazioni senza reparto identificato richiedono destinatari amministrativi globali.'),{code:'FINDING_SCOPE_UNRESOLVED'});
 const recipients = await authorizedRecipients(db,policy,departments);
 // Never requeue a recipient after a prior attempt, including uncertain/failed.
 // Content hashes alone are insufficient when the summary format changes.
 const previous = must(await db.from('anomaly_deliveries').select('recipient_id,status').eq('run_id',run.id).eq('channel','email'));
 const attempted = new Set(previous.map(row => row.recipient_id));
 const remaining = recipients.filter(person => !attempted.has(person.userId));
 const jobs = buildEmailJobs({recipients:remaining,day:window.from,window,findings,coverage,runUrl:`https://workspace.progre.it/anomalie?run=${encodeURIComponent(run.id)}`});
 if (!jobs.length) return { queued:0, reason:'no_new_recipients' };
 return { queued:must(await db.rpc('anomaly_queue_email',{p_actor:actorId,p_run:run.id,p_jobs:jobs})) };
}

export async function claimAnomalyEmail(db, workerId) {
 const data = must(await db.rpc('anomaly_claim_email',{p_worker:workerId}));
 const job = Array.isArray(data) ? data[0] : data;
 if (!job) return null;
 return { status:'claimed', worker_id:workerId, email:{id:`anomaly:${job.id}`,lock_token:job.lock_token,destinatario:job.recipient_email,oggetto:job.subject,corpo:job.body}, attachments:[] };
}

export async function anomalyEmailAction(db, body) {
 const id=String(body.email_id||'').slice('anomaly:'.length);
 if (!/^[a-f0-9-]{36}$/i.test(id) || !body.worker_id || !body.lock_token) throw Object.assign(Error('Conferma email non valida.'),{status:400});
 if (!['complete','retry'].includes(body.action)) throw Object.assign(Error('Azione worker non valida.'),{status:400});
 const status=body.action==='complete'?'accepted':body.definitive===true?'failed':'uncertain';
 const data=must(await db.rpc('anomaly_finish_email',{p_id:id,p_worker:body.worker_id,p_lock:body.lock_token,p_status:status,p_receipt:body.action==='complete'?String(body.message_id||'').slice(0,1000):null}));
 return {status:data===true?status:'uncertain_requires_review'};
}

export function anomalyWorkerId() { return `anomaly-email:${randomUUID()}`; }
export function authorizedAnomalyWorkerRequest(req,env=process.env){
 const supplied=String(req.headers?.authorization||'').replace(/^Bearer\s+/i,'').trim(),expected=String(env.ARUBA_EMAIL_WORKER_SECRET||'');
 const left=Buffer.from(supplied),right=Buffer.from(expected);
 return !!expected&&left.length===right.length&&timingSafeEqual(left,right);
}

export async function anomalyWorkerReady(fetchImpl=fetch,env=process.env){
 const url=env.ARUBA_EMAIL_WORKER_URL,secret=env.ARUBA_EMAIL_WORKER_SECRET;
 if(!url||!secret)throw Object.assign(Error('Worker Aruba non configurato.'),{code:'EMAIL_WORKER_NOT_CONFIGURED'});
 const probe=new URL(url);probe.searchParams.set('action','anomaly_email_capabilities');
 const response=await fetchImpl(probe.toString(),{method:'GET',headers:{'X-Progre-Worker-Secret':secret},signal:AbortSignal.timeout(15000)});
 const capability=await response.json();
 if(!response.ok||capability.anomaly_email_protocol!==1||capability.queue_enabled!==true||capability.attachments_enabled!==false||capability.text_only!==true||!capability.from_email)throw Object.assign(Error('Worker email testuale Anomalie non pronto.'),{code:'EMAIL_WORKER_NOT_READY'});
 return capability;
}

export async function dispatchAnomalyEmails({fetchImpl=fetch,env=process.env}={}){
 await anomalyWorkerReady(fetchImpl,env);
 const response=await fetchImpl(env.ARUBA_EMAIL_WORKER_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Progre-Worker-Secret':env.ARUBA_EMAIL_WORKER_SECRET},body:JSON.stringify({action:'run_anomalies'}),signal:AbortSignal.timeout(300000)});
 const result=await response.json();
 if(!response.ok||result.status!=='ok'||(result.results||[]).some(x=>!['sent','idle'].includes(x.status)))throw Object.assign(Error('Worker email: esito da verificare nel registro consegne prima di ripetere.'),{code:'EMAIL_DISPATCH_REQUIRES_REVIEW',outcomes:(result.results||[]).map(x=>x.status)});
 return {status:'dispatch_completed',results:result.results};
}

export async function verifyAnomalyReadiness(db,{ownerId,fetchImpl=fetch,env=process.env,collectSnapshot}={}){
 const agent=must(await db.from('anomaly_agents').select('readiness,enabled,recipient_policy').eq('code','fabbisogni').single());
 if(agent.enabled)throw Object.assign(Error('Disattivare il servizio prima di aggiornare la readiness.'),{code:'AGENT_ALREADY_ENABLED'});
 const owner=must(await db.from('utenti').select('id,auth_user_id,attivo,ruoli(amministratore_workspace)').eq('id',ownerId).maybeSingle());
 if(owner?.attivo!==true||owner.ruoli?.amministratore_workspace!==true)throw Object.assign(Error('Titolare non autorizzato.'),{code:'OWNER_NOT_AUTHORIZED'});
 const {collectControlSnapshot}=await import('./sources.js');
 const scheduledOwnerId=env.FABBISOGNI_OWNER_PROFILE_ID;
 if(!scheduledOwnerId)throw Object.assign(Error('Titolare pianificato non configurato.'),{code:'SCHEDULED_OWNER_NOT_CONFIGURED'});
 const snapshot=await (collectSnapshot||collectControlSnapshot)(db,scheduledOwnerId,{now:new Date()});
 const coverage=snapshot.coverage||{};
 const required=['planning','bom','stock','requirements','purchaseOrders','receipts','quality','capacity','movements','stock_reconciliation'];
 const gaps=required.filter(name=>coverage[name]?.complete!==true);
 let email;try{email={ready:true,...await anomalyWorkerReady(fetchImpl,env)}}catch(error){email={ready:false,code:error.code||'worker_error'}}
 const recipientResults={ready:false,reason:'Destinatari di ciascun perimetro da verificare.'};
 const departments=must(await db.from('reparti').select('id,nome').eq('attivo',true));
 try{recipientResults.ready=true;await authorizedRecipients(db,agent.recipient_policy,departments.map(x=>x.id));}
 catch(error){recipientResults.ready=false;recipientResults.code=error.code||'recipient_error'}
 const ready=email.ready&&recipientResults.ready;
 const readiness={ready,emailReady:email.ready,reason:ready?'Email testuale verificata e destinatari autorizzati verificati. Il report evidenzia ogni lacuna di copertura.':`Servizio bloccato: email ${email.ready?'verificata':'non verificata'}; destinatari ${recipientResults.ready?'verificati':'non verificati'}.`,checkedAt:new Date().toISOString(),dataCoverageComplete:gaps.length===0,coverage:Object.fromEntries(required.map(k=>[k,{complete:coverage[k]?.complete===true,reason:coverage[k]?.reason||null}])),email:{ready:email.ready,from:email.from_email||null},recipients:{ready:recipientResults.ready,code:recipientResults.code||null}};
 const updated=must(await db.rpc('anomaly_set_readiness',{p_actor:ownerId,p_ready:readiness}));
 const current=must(await db.from('anomaly_agents').select('config_version,enabled').eq('code','fabbisogni').single());
 return {updated,readiness,configVersion:current.config_version,enabled:current.enabled};
}

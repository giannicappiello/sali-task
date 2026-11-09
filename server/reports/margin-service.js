import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {canReadFinance,requireFinanceAdmin} from '../second-brain/mexal-finance.js';
import {objectSchema,uuidSchema} from '../second-brain/schema.js';
import {MARGIN_POLICY,MARGIN_POLICY_HASH,checkMarginPeriod,marginEnvelope} from './margin-policy.js';
import {must,requireThat} from './commercial-policy.js';
import {assertOwner,dispatchCommercialReports} from './commercial-service.js';
export const MARGIN_REVIEW_URL='https://workspace.progre.it/settings/margin-reports';
const publicFields='id,owner_id,policy_hash,period,status,filename,sha256,bytes,pages,verified,notes,created_at,sent_at';
export async function marginPlan(auth){
 await requireFinanceAdmin(auth);
 const plan=must(await auth.admin.from('margin_report_plans').select('*').eq('owner_id',auth.profile.id).maybeSingle());
 const runs=must(await auth.admin.from('margin_report_runs').select(publicFields).eq('owner_id',auth.profile.id).order('created_at',{ascending:false}).limit(24));
 return {policy:MARGIN_POLICY,policyHash:MARGIN_POLICY_HASH,enabled:plan?.enabled===true&&plan.policy_hash===MARGIN_POLICY_HASH,approvedAt:plan?.approved_at||null,runs,reviewUrl:MARGIN_REVIEW_URL};
}
export async function marginDispatch(){return dispatchCommercialReports();}
export async function marginArtifact(auth,input){
 await requireFinanceAdmin(auth);const db=auth.admin;
 if(input.action==='start'){
  checkMarginPeriod(input.period);
  let plan=must(await db.from('margin_report_plans').select('*').eq('owner_id',auth.profile.id).maybeSingle());
  if(!plan){must(await db.from('margin_report_plans').insert({owner_id:auth.profile.id,policy_hash:MARGIN_POLICY_HASH}));plan={enabled:false,policy_hash:MARGIN_POLICY_HASH};}
  requireThat(plan.policy_hash===MARGIN_POLICY_HASH,'Piano variato: nuova attivazione umana richiesta.',409);
  const old=must(await db.from('margin_report_runs').select(publicFields).eq('owner_id',auth.profile.id).eq('period',input.period).maybeSingle());
  if(old)return {run:old,alreadyExists:true,reviewUrl:MARGIN_REVIEW_URL};
  const inserted=await db.from('margin_report_runs').insert({owner_id:auth.profile.id,policy_hash:MARGIN_POLICY_HASH,period:input.period,notes:String(input.notes||'').slice(0,3000)}).select(publicFields).single();
  if(inserted.error?.code==='23505')return marginArtifact(auth,input);
  return {run:must(inserted),reviewUrl:MARGIN_REVIEW_URL};
 }
 const run=must(await db.from('margin_report_runs').select(publicFields).eq('id',input.runId).eq('owner_id',auth.profile.id).maybeSingle());
 requireThat(run&&run.policy_hash===MARGIN_POLICY_HASH,'Lotto non accessibile.',404);
 if(input.action==='status')return {run,reviewUrl:MARGIN_REVIEW_URL};
 const plan=must(await db.from('margin_report_plans').select('*').eq('owner_id',auth.profile.id).maybeSingle());
 if(input.action==='dispatch'){
  requireThat(plan?.enabled&&plan.policy_hash===MARGIN_POLICY_HASH,'Attivazione umana del piano necessaria.',403);
  if(run.status!=='queued')return {run,dispatch:'not_repeated'};
  return {run,dispatch:await marginDispatch()};
 }
 requireThat(run.status==='draft'||(input.action==='finalize'&&run.sha256===input.sha256),'PDF già verificato o invio già avviato: leggere lo stato.',409);
 if(input.action==='chunk'){
  requireThat(Number.isInteger(input.part)&&Number.isInteger(input.total)&&input.total>0&&input.total<=100&&input.part>=0&&input.part<input.total,'Blocco non valido.');
  requireThat(/^[A-Za-z0-9+/=]+$/.test(input.base64||'')&&input.base64.length<=40000,'Base64 non valido.');
  const old=must(await db.from('margin_report_chunks').select('base64,total').eq('run_id',run.id).eq('part',input.part).maybeSingle());
  if(old)requireThat(old.base64===input.base64&&old.total===input.total,'Blocco diverso da quello già acquisito.',409);
  else must(await db.from('margin_report_chunks').insert({run_id:run.id,part:input.part,total:input.total,base64:input.base64}));
  return {status:'stored',part:input.part};
 }
 requireThat(input.action==='finalize'&&input.verified===true,'Verificare tutte le pagine del PDF prima di finalizzare.');
 if(run.sha256===input.sha256)return {run,alreadyFinalized:true};
 checkMarginPeriod(run.period);
 const chunks=must(await db.from('margin_report_chunks').select('part,total,base64').eq('run_id',run.id).order('part'));
 requireThat(chunks.length>0&&chunks.every((c,i)=>c.part===i&&c.total===chunks.length),'Blocchi incompleti.');
 const encoded=chunks.map(c=>c.base64).join(''),bytes=Buffer.from(encoded,'base64');
 requireThat(bytes.length<=2000000&&bytes.subarray(0,5).toString()==='%PDF-'&&bytes.toString('base64')===encoded,'Allegato PDF non valido.');
 requireThat(createHash('sha256').update(bytes).digest('hex')===input.sha256,'Integrità PDF non verificata.');
 const pdf=await PDFDocument.load(bytes);requireThat(pdf.getPageCount()>=3,'PDF incompleto.');
 const status=plan?.enabled&&plan.policy_hash===MARGIN_POLICY_HASH?'queued':'staged';
 const updated=must(await db.from('margin_report_runs').update({status,base64:encoded,sha256:input.sha256,bytes:bytes.length,pages:pdf.getPageCount(),verified:true,filename:'Report_Marginalita_Progre_'+run.period.slice(0,7)+'.pdf'}).eq('id',run.id).eq('status','draft').select(publicFields).maybeSingle());
 requireThat(updated,'Lotto cambiato durante la finalizzazione; leggere lo stato.',409);
 must(await db.from('margin_report_chunks').delete().eq('run_id',run.id));
 return {run:updated,reviewUrl:MARGIN_REVIEW_URL,requiresHumanActivation:status==='staged',sent:false};
}
export function marginReportTools(auth){
 if(!canReadFinance(auth))return {};
 return {
  MARGIN_REPORT_PLAN:{effect:'read',description:'Legge il piano autorizzato del report marginalità Mexal GRE: PDF annuale aggiornato ogni 10, destinatari fissi Giovanni Cappiello e Roberto Profili, stato e registro invii. Nessuna attivazione o invio.',inputSchema:objectSchema(),execute:()=>marginPlan(auth)},
  MARGIN_REPORT_ARTIFACT:{effect:'artifact',description:'Prepara un solo PDF verificato della marginalità GRE da gennaio all’ultimo mese chiuso. start, chunk base64 max 40000 e finalize con hash; prima attivazione umana separata in Workspace. dispatch invia solo dopo piano attivo. Stato uncertain mai reinviato. Nessun destinatario libero.',inputSchema:objectSchema({action:{type:'string',enum:['start','chunk','finalize','status','dispatch']},period:{type:'string',format:'date'},runId:uuidSchema,notes:{type:'string',maxLength:3000},part:{type:'integer',minimum:0,maximum:99},total:{type:'integer',minimum:1,maximum:100},base64:{type:'string',maxLength:40000},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},verified:{type:'boolean'}},['action']),execute:input=>marginArtifact(auth,input)},
 };
}
export async function claimMarginEmail(db,worker){
 const result=must(await db.rpc('margin_report_claim',{p_worker:worker,p_policy:MARGIN_POLICY_HASH})),job=Array.isArray(result)?result[0]:result;
 if(!job)return null;
 return {status:'claimed',worker_id:worker,email:{id:'report:margin:'+job.id,lock_token:job.lock_token,destinatario:marginEnvelope(job.period).recipient,oggetto:marginEnvelope(job.period).subject,corpo:marginEnvelope(job.period).body},attachments:[{filename:job.filename,content_type:'application/pdf',report_artifact_key:'margin',sha256:job.sha256,bytes:job.bytes}]};
}
export async function marginWorkerAction(db,body){
 const id=String(body.email_id||'').slice('report:margin:'.length);requireThat(/^[a-f0-9-]{36}$/i.test(id),'Invio non valido.');
 const job=must(await db.from('margin_report_runs').select('*').eq('id',id).eq('worker_id',body.worker_id).eq('lock_token',body.lock_token).maybeSingle());requireThat(job,'Invio non accessibile.',403);
 const plan=must(await db.from('margin_report_plans').select('*').eq('owner_id',job.owner_id).maybeSingle());
 requireThat(plan?.enabled&&plan.policy_hash===MARGIN_POLICY_HASH&&job.policy_hash===MARGIN_POLICY_HASH,'Piano non attivo.',403);await assertOwner(db,job.owner_id);
 if(body.action==='attachment'){
  requireThat(body.report_artifact_key==='margin'&&job.status==='uncertain','Allegato fuori dal piano.',403);
  requireThat(createHash('sha256').update(Buffer.from(job.base64,'base64')).digest('hex')===job.sha256,'Integrità PDF non valida.');
  return {filename:job.filename,base64:job.base64,sha256:job.sha256};
 }
 if(body.action==='complete'){
  if(job.status==='sent')return {status:'already_completed'};
  requireThat(job.status==='uncertain','Stato invio cambiato.',409);
  must(await db.from('margin_report_runs').update({status:'sent',sent_at:new Date().toISOString(),provider_message_id:String(body.message_id||'').slice(0,998)}).eq('id',job.id).eq('status','uncertain').eq('lock_token',job.lock_token));return {status:'completed'};
 }
 requireThat(body.action==='retry','Azione non valida.');return {status:job.status==='sent'?'already_completed':'uncertain_requires_review'};
}

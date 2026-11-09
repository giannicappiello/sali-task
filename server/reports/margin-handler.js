import process from 'node:process';
import {timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {waitUntil} from '@vercel/functions';
import {authorizeAIRequest} from '../ai/access.js';
import {createReceipt,verifyReceipt} from '../second-brain/handler.js';
import {requireFinanceAdmin} from '../second-brain/mexal-finance.js';
import {MARGIN_AGENT_HASH,MARGIN_POLICY_HASH,marginHash} from './margin-policy.js';
import {marginAgentConnection,triggerMarginReports} from './margin-trigger.js';
import {createProgremesReadonlyAdmin} from '../progremes-readonly-auth.js';
import {marginPlan,marginDispatch} from './margin-service.js';
import {must,requireThat} from './commercial-policy.js';
import {workerReady} from './commercial-service.js';
const approvalHash=(owner,run)=>marginHash({owner,policy:MARGIN_POLICY_HASH,agent:MARGIN_AGENT_HASH,runId:run.id,pdf:run.sha256});
export async function marginHumanRequest(req,{authorize=authorizeAIRequest,key=process.env.SUPABASE_SERVICE_ROLE_KEY,checkWorker=workerReady,dispatch=marginDispatch,schedule=waitUntil}={}){
 const auth=await authorize(req);await requireFinanceAdmin(auth);const db=auth.admin;
 if(req.method==='GET'){
  const plan=await marginPlan(auth);let mail;try{mail=await checkWorker();}catch{mail={ready:false};}return {...plan,mail};
 }
 requireThat(req.method==='POST'&&req.body&&JSON.stringify(req.body).length<10000,'Richiesta non valida.');
 requireThat(key,'Conferma non disponibile.',503);
 if(req.body.action==='confirmation'){
  requireThat(/^[a-f0-9-]{36}$/i.test(req.body.runId||''),'Lotto non valido.');
  const run=must(await db.from('margin_report_runs').select('id,owner_id,status,sha256,filename,period,notes').eq('id',req.body.runId).eq('owner_id',auth.profile.id).maybeSingle());
  requireThat(run?.status==='staged'&&run.sha256,'PDF non pronto per l’attivazione.',409);await checkWorker();
  requireThat((await marginAgentConnection(db,auth.profile.id)).ready,'Collegamento ChatGPT del titolare non disponibile.',409);
  return {run,receipt:createReceipt({userId:auth.profile.id,kind:'margin-report-plan',id:run.id,hash:approvalHash(auth.profile.id,run),expires:Date.now()+300000},key)};
 }
 if(req.body.action==='pdf'){
  const run=must(await db.from('margin_report_runs').select('filename,base64').eq('id',req.body.runId).eq('owner_id',auth.profile.id).maybeSingle());requireThat(run?.base64,'PDF non disponibile.',404);return {file:run};
 }
 requireThat(req.body.action==='activate'&&req.body.confirmPlan===true,'Conferma esplicita richiesta.');
 const receipt=verifyReceipt(req.body.receipt,key,auth.profile.id);requireThat(receipt.kind==='margin-report-plan','Conferma non valida per questo piano.',403);
 const run=must(await db.from('margin_report_runs').select('id,status,sha256').eq('id',receipt.id).eq('owner_id',auth.profile.id).maybeSingle());
 requireThat(run?.status==='staged'&&approvalHash(auth.profile.id,run)===receipt.hash,'PDF o piano cambiato: riaprire il riepilogo.',409);await checkWorker();
 requireThat((await marginAgentConnection(db,auth.profile.id)).ready,'Collegamento ChatGPT del titolare non disponibile.',409);
 must(await db.rpc('margin_report_activate',{p_owner:auth.profile.id,p_policy:MARGIN_POLICY_HASH,p_run:run.id,p_pdf:run.sha256}));
 schedule(dispatch().catch(()=>({status:'dispatch_unverified'})));
 return {enabled:true,status:'queued',sent:false,message:'Piano attivato e primo invio accodato. Lo stato nel registro conferma l’esito del servizio.'};
}
export async function handleMarginReports(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  if(req.query?.cron==='1'){
   requireThat(req.method==='GET','Metodo non consentito.',405);
   const expected=String(process.env.CRON_SECRET||''),actual=String(req.headers.authorization||'').replace(/^Bearer /,'');
   requireThat(expected&&actual.length===expected.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected)),'Cron non autorizzato.',401);
   return res.json({success:true,...await triggerMarginReports(createProgremesReadonlyAdmin(),{dispatch:marginDispatch})});
  }
  return res.json({success:true,...await marginHumanRequest(req)});
 }catch(error){return res.status(Number(error.status)||500).json({success:false,error:Number(error.status)<500?error.message:'Configurazione report non disponibile. Verifica lo stato prima di ripetere.'});}
}

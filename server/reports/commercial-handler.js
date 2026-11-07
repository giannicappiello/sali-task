import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { authorizeAIRequest } from '../ai/access.js';
import { createProgremesReadonlyAdmin } from '../progremes-readonly-auth.js';
import {AGENTS,POLICY_HASH,must,requireThat,sealToken} from './commercial-policy.js';
import {reportSettings,reportPlan,workerReady,triggerMonthlyReports,loadReportRecipients} from './commercial-service.js';

export async function handleCommercialReports(req,res,{authorize=authorizeAIRequest,admin=createProgremesReadonlyAdmin,workerCheck=workerReady}={}) {
  try {
    if(req.query?.cron==='1') {
      requireThat(req.method==='GET','Metodo non consentito.',405);
      const expected=String(globalThis.process.env.CRON_SECRET||''),actual=String(req.headers.authorization||'').replace(/^Bearer /,'');
      requireThat(expected&&actual.length===expected.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected)),'Cron non autorizzato.',401);
      return res.json(await triggerMonthlyReports(admin()));
    }
    const auth=await authorize(req);
    requireThat(auth.profile.ruoli?.amministratore_workspace===true,'Configurazione riservata agli amministratori Workspace.',403);
    if(req.method==='GET') {
      const plan=await reportPlan(auth),settings=await reportSettings(auth.admin);
      let mail;try{mail=await workerCheck();}catch(error){mail={ready:false,message:error.message};}
      return res.json({...plan,triggerId:settings?.trigger_id||'',hasToken:!!settings?.token_encrypted,mail});
    }
    requireThat(req.method==='POST'&&req.body?.action==='configure','Richiesta non valida.');
    const old=await reportSettings(auth.admin);
    requireThat(!old||old.owner_id===auth.profile.id,'Il piano appartiene a un altro titolare.',403);
    requireThat(req.body.policyHash===POLICY_HASH&&req.body.confirmPlan===true,'Rileggere e confermare il piano attuale.',409);
    if(req.body.enabled===false&&old) {
      must(await auth.admin.from('commercial_report_settings').update({enabled:false}).eq('singleton',true).eq('owner_id',auth.profile.id));
      return res.json({status:'disabled'});
    }
    requireThat(req.body.enabled===true,'Attivazione non richiesta.');
    requireThat(/^agtch_[a-zA-Z0-9_]+$/.test(req.body.triggerId||''),'Indicare il canale API pubblicato dell’agente ChatGPT.');
    const supplied=String(req.body.accessToken||'').trim();
    requireThat((supplied.length>=20&&supplied.length<=4096)||old?.token_encrypted,'Autorizzazione agente ChatGPT mancante.');
    const key=globalThis.process.env.SUPABASE_SERVICE_ROLE_KEY;
    requireThat(key,'Cifratura del collegamento non disponibile.',503);
    await loadReportRecipients(auth.admin);await workerCheck();
    must(await auth.admin.from('commercial_report_settings').upsert({singleton:true,owner_id:auth.profile.id,enabled:true,policy_hash:POLICY_HASH,trigger_id:req.body.triggerId,token_encrypted:supplied?sealToken(supplied,key,auth.profile.id):old.token_encrypted,approved_at:new Date().toISOString()}));
    return res.json({status:'enabled',agents:AGENTS.length,schedule:{day:10,time:'10:00',timezone:'Europe/Rome'}});
  }catch(error){return res.status(error.status||500).json({error:error.status?error.message:'Collegamento report non disponibile. Verificare configurazione e registro.'});}
}

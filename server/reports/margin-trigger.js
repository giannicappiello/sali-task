import {MARGIN_AGENT,MARGIN_AGENT_HASH,MARGIN_POLICY_HASH,marginPeriod,checkMarginPeriod,marginTriggerDue} from './margin-policy.js';
import {must,requireThat,unsealToken} from './commercial-policy.js';
import {reportSettings,assertOwner} from './commercial-service.js';
export async function marginAgentConnection(db,owner){
 const settings=await reportSettings(db);
 return {agent:MARGIN_AGENT,ready:settings?.owner_id===owner&&!!settings?.token_encrypted};
}
export function marginTriggerPrompt(period,now=new Date()){
 const range=checkMarginPeriod(period,now);
 return `Esegui il report mensile marginalità lavorazioni Progre GRE dal ${range.from} al ${range.to}. Usa le istruzioni e i quattro file dell'agente; rileggi tutti i dati aggiornati da Mexal via Second Brain Progrè, senza riutilizzare i numeri del PDF di esempio. Leggi prima MARGIN_REPORT_PLAN: procedi solo se enabled e automation.enabled sono entrambi true. Controlla il periodo ${period}; se esiste già un PDF verified/staged/queued/uncertain/sent non duplicarlo. Per ogni mese leggi SL netti IVA, contabilità per data statistica con ripiego data registrazione e inventario IT* dal primo all'ultimo giorno inclusi, un mese per chiamata senza includeSources. Rispetta esattamente il master Word Progre, senza grafico sul frontespizio, verificando tutte le pagine. Non inventare costi mancanti o distinte. Carica il solo PDF verificato tramite MARGIN_REPORT_ARTIFACT start/chunk/finalize e poi dispatch; invii limitati dal piano a Giovanni Cappiello e Roberto Profili. Non attivare piani, modificare gestionali, usare destinatari alternativi o ripetere invii incerti.`;
}
export async function triggerMarginReports(db,{now=new Date(),fetchImpl=fetch,secret=globalThis.process.env.SUPABASE_SERVICE_ROLE_KEY,dispatch}={}){
 if(!marginTriggerDue(now))return {status:'not_due'};
 // Giovanni separately authorized this fixed API channel in chat. The existing
 // human-approved monthly delivery plan remains the required business delegation.
 const plans=must(await db.from('margin_report_plans').select('owner_id,policy_hash,enabled,approved_by,approved_at').eq('enabled',true).eq('policy_hash',MARGIN_POLICY_HASH));
 const results=[];
 for(const plan of plans){
  requireThat(plan.approved_by===plan.owner_id&&plan.approved_at,'Piano agente non approvato.',403);
  await assertOwner(db,plan.owner_id);
  const period=marginPeriod(now),existing=must(await db.from('margin_report_runs').select('id,status').eq('owner_id',plan.owner_id).eq('period',period).maybeSingle());
  if(existing){
   if(existing.status==='queued'&&dispatch)await dispatch();
   results.push({status:'existing_report',period,reportStatus:existing.status});continue;
  }
  const settings=await reportSettings(db);
  requireThat(settings?.owner_id===plan.owner_id&&settings.token_encrypted,'Collegamento ChatGPT del titolare non disponibile.',409);
  const old=must(await db.from('margin_report_triggers').select('id,status,conversation_url').eq('owner_id',plan.owner_id).eq('period',period).maybeSingle());
  if(old){results.push({status:'already_triggered',period,triggerStatus:old.status});continue;}
  const inserted=await db.from('margin_report_triggers').insert({owner_id:plan.owner_id,period,policy_hash:MARGIN_POLICY_HASH,agent_hash:MARGIN_AGENT_HASH,status:'triggering'}).select('id').single();
  if(inserted.error?.code==='23505'){results.push({status:'already_triggered',period});continue;}
  const trigger=must(inserted);
  try{
   const token=unsealToken(settings.token_encrypted,secret,plan.owner_id);
   const response=await fetchImpl(`https://api.chatgpt.com/v1/workspace_agents/${MARGIN_AGENT.channel}/trigger`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':'progre-margin-'+plan.owner_id+'-'+period,'OpenAI-Beta':'workspace_agent_runs=v1'},body:JSON.stringify({conversation_key:'progre-margin-'+plan.owner_id+'-'+period,input:marginTriggerPrompt(period,now)}),signal:AbortSignal.timeout(25000)});
   requireThat(response.status===202,'Avvio ChatGPT da verificare: nessuna ripetizione automatica.',502);
   const result=await response.json();requireThat(/^https:\/\/chatgpt\.com\/c\/[a-zA-Z0-9-]+$/.test(result.conversation_url||''),'Risposta ChatGPT da verificare.',502);
   must(await db.from('margin_report_triggers').update({status:'requested',conversation_url:result.conversation_url,trigger_run_id:result.agent_trigger_run_id||null}).eq('id',trigger.id));
   results.push({status:'requested',period,conversationUrl:result.conversation_url});
  }catch(error){
   // An accepted request may time out. Keep the unique period locked for human review.
   await db.from('margin_report_triggers').update({status:'attention'}).eq('id',trigger.id);
   throw error;
  }
 }
 return {status:results.length?'checked':'no_active_plan',results};
}

import { isDeepStrictEqual } from 'node:util';
import { Buffer } from 'node:buffer';
import { createHash,randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { waitUntil } from '@vercel/functions';
import { AGENTS,POLICY_HASH,MAX_PDF_BYTES,REPORT_AGENT,must,requireThat,resolveRecipients,buildDeliveries,buildReportManifest,recipientsFingerprint,reportPeriod,reportDeliveryDue,unsealToken } from './commercial-policy.js';

export async function loadReportRecipients(db) {
  const agents=must(await db.from('mexal_agenti').select('codice,email,attivo_mexal,workspace_utente_id,responsabile_utente_id').in('codice',AGENTS.map(a=>a.code)))||[];
  const ids=[...new Set(agents.flatMap(a=>[a.workspace_utente_id,a.responsabile_utente_id]).filter(Boolean))];
  let users=ids.length?must(await db.from('utenti').select('id,nome,cognome,email,attivo,responsabile_utente_id').in('id',ids)):[];
  const missing=[...new Set(users.map(u=>u.responsabile_utente_id).filter(id=>id&&!ids.includes(id)))];
  if(missing.length)users=[...users,...must(await db.from('utenti').select('id,nome,cognome,email,attivo,responsabile_utente_id').in('id',missing))];
  return resolveRecipients(agents,users);
}
export async function reportSettings(db) {
  return must(await db.from('commercial_report_settings').select('*').eq('singleton',true).maybeSingle());
}
export async function assertOwner(db,ownerId) {
  const owner=must(await db.from('utenti').select('id,attivo,ruoli(amministratore_workspace)').eq('id',ownerId).maybeSingle());
  requireThat(owner?.attivo===true&&owner.ruoli?.amministratore_workspace===true,'Il titolare del piano non è più autorizzato.',403);
}
export async function workerReady(fetchImpl=fetch) {
  const url=globalThis.process.env.ARUBA_EMAIL_WORKER_URL,secret=globalThis.process.env.ARUBA_EMAIL_WORKER_SECRET;
  requireThat(url&&secret,'Servizio email Workspace non configurato.',503);
  const probe=new URL(url);probe.searchParams.set('action','report_capabilities');
  // GET is essential: the old worker treats any unknown POST action as 'run'.
  // Old versions return 405 for GET without ever consuming real order emails.
  const r=await fetchImpl(probe.toString(),{method:'GET',headers:{'X-Progre-Worker-Secret':secret},signal:AbortSignal.timeout(15000)});
  const result=await r.json();
  requireThat(r.ok&&result.report_protocol===1&&result.queue_enabled===true,'Aggiornare il worker email Workspace al protocollo report prima di attivare.',503);
  return {ready:true,from:result.from_email};
}
export async function dispatchCommercialReports(fetchImpl=fetch) {
  await workerReady(fetchImpl);
  const response=await fetchImpl(globalThis.process.env.ARUBA_EMAIL_WORKER_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Progre-Worker-Secret':globalThis.process.env.ARUBA_EMAIL_WORKER_SECRET},body:JSON.stringify({action:'run_reports'}),signal:AbortSignal.timeout(300000)});
  const result=await response.json();
  requireThat(response.ok&&result.status==='ok'&&Array.isArray(result.results)&&result.results.every(x=>['sent','idle'].includes(x.status)),'Invio report da verificare nel registro. Non ripetere invii incerti.',502);
  return {status:'dispatch_completed',results:result.results};
}
// Versioned operating instructions for future runs; no change to approval policy or schedule.
export const COMMERCIAL_REPORT_INSTRUCTIONS_VERSION = '2026-11-11.v4';
export const COMMERCIAL_REPORT_INSTRUCTIONS = "Istruzioni operative preventive v4. Prima di generare leggi BRAIN_STATUS, COMMERCIAL_REPORT_PLAN e COMMERCIAL_REPORT_ARTIFACT status del medesimo lotto. Verifica identità, delega attiva, periodo, manifest e policy correnti. Usa le fatture ufficiali Second Brain–Workspace per Professional e ordiniph per Farmacie. Il precedente disallineamento fatture comunicato dal titolare come risolto non è da solo un blocco attuale: verifica i dati correnti e segnala solo discrepanze documentate, senza sostituire la fonte. Pagina fino a nextOffset=null; riconcilia righe, documenti, clienti distinti e riepiloghi nello stesso perimetro. Non scambiare clienti mensili, cumulati annui e portafoglio; ogni percentuale deve avere un denominatore verificato. Dati mancanti non sono zero.\nPrima del lotto completo esegui un preflight reale del master Progre originale, dei font e del renderer DOCX-to-PDF. Usa solo componenti disponibili e verificati nel runtime corrente: non presumere che file temporanei di esecuzioni precedenti esistano ancora. Conserva versione e checksum del motore e del master. Aggiorna realmente l’indice, salva, riapri ed esporta; verifica nel PDF numeri pagina e destinazioni, ripetendo entro un limite esplicito fino a convergenza. Non sostituire con un indice statico o un layout generico. Se mancano componenti o il preflight fallisce, segnala esattamente il componente e il test fallito prima di produrre sedici documenti.\nInvia esclusivamente PDF, mai DOCX/Word: i Word restano intermedi interni. Verifica tutte le pagine, logo, indice, header/footer, tabelle e grafici; usa tick interi per conteggi e unità sull’asse corretto. Confronta i numeri con input validati e imposta verified=true soltanto dopo QA completa sul PDF finale e sul suo SHA-256.\nEntro il piano attivo e il manifest approvato esegui le attività già autorizzate senza richiedere permessi equivalenti. Questo testo non conferisce nuovi permessi: mantieni BRAIN_REVIEW e le conferme umane obbligatorie, senza automatizzarle. Non modificare destinatari, deleghe, calendario o perimetro. Dopo un diniego interrompi l’operazione: non aggirare il controllo, non usare canali alternativi e non ritentare senza nuova evidenza pertinente e verifica dell’esito.\nPrima di riprendere dopo errore o timeout leggi lo stato. Riutilizza i PDF già finalizzati solo se SHA-256 e QA corrispondono; non rigenerare o ricaricare file confermati senza necessità. Lo status mostra file finali e, per i report mancanti, receivedParts e missingParts: riprendi solo le parti mancanti dopo aver verificato gli eventuali blocchi specifici. Un esito incerto non autorizza un retry. I caricamenti sono ammessi ogni giorno: un lotto completo viene inviato dalla data approvata in poi, anche in ritardo. Leggi schedule e nextDay dal piano attuale: dopo il primo lotto confermato il calendario passa al giorno 2. Per un retry consentito usa gli stessi batchId, artifactKey, part, total e bytes; nessuna parte in parallelo e finalizzazioni seriali. Non creare un secondo lotto, non cancellare lo storico e non reinviare email con esito uncertain. queued non significa sent: conferma l’invio solo quando tutti gli esiti previsti sono sent con sent_at, senza dichiarare consegna al destinatario. Comunica soltanto risultato verificato, cambiamenti sostanziali o blocchi azionabili.";
export function triggerPrompt(batch) {
  return `Esegui il lotto report commerciali autorizzato ${batch.id}, mese ${batch.period}, titolare Workspace corrente. Leggi COMMERCIAL_REPORT_PLAN e usa ESATTAMENTE il manifest di questo lotto. Genera i 14 PDF individuali, i consolidati dei gruppi PR e PH e gli eventuali consolidati dei responsabili richiesti dal manifest. Riutilizza i dati verificati dei singoli agenti: clienti distinti e documenti senza duplicazioni, percentuali ricalcolate sui totali, mai medie di percentuali; per ogni consolidato aggiungi classifica agenti per valore, quota, crescita, clienti attivi, copertura portafoglio, valore medio e tasso di riacquisto; grafici di contributo agenti e matrice prodotti per agente. Applica la skill progre-ai, template originale e almeno i 7 grafici approvati. Professional usa fatture; Farmacie usa ordiniph. Per CRM_CUSTOMER_SEARCH usa type=b2b: Farmacie orderModule=ph e customerGroup=all; Professional orderModule=prof e customerGroup=regular. Usa agent dal manifest e il periodo del lotto; pagina fino a nextOffset=null. Per COMMERCIAL_REPORT_DATA usa prima kind=products per ogni agente e completa tutte le pagine; solo dopo usa kind=lines con productCode reale restituito dai prodotti, paginando separatamente ogni prodotto fino a nextOffset=null. Non chiamare lines senza productCode e non inventare codici. Mantieni un registro di avanzamento per artifactKey: stato, pagine/cursori completati, prodotti completati, fonti verificate, hash PDF, QA, caricamento/esito persistito, errore, tentativi e prossimo passo. Dopo un errore conserva il lavoro verificato e classifica la causa. Per INVALID_ARGUMENT o validazione esplicita certamente avvenuta prima della RPC, correggi autonomamente solo il parametro dimostrato errato entro il perimetro autorizzato e prova una volta; se fallisce ancora isola quel report e continua gli indipendenti. Un errore generico non prova mancata esecuzione. Per errori transitori noti ammetti al massimo due retry con attesa crescente solo su letture idempotenti o operazioni con idempotenza documentata, dopo verifica dello stato disponibile e della sicurezza della ripetizione; non duplicare trigger, upload o invii. Non ritentare denied, 401/403, approval_timeout, esito uncertain o timeout generico: conserva il blocco finché nuova autorizzazione esplicita o diagnosi documentata ne risolve la causa e lo stato esclude una duplicazione. Per gli artifact leggi COMMERCIAL_REPORT_ARTIFACT action=status prima di ripetere; ACTION_STATUS non legge il registro delle chiamate CRM. Se lo stato necessario non è accessibile, isola l'operazione e segnala il requisito senza presumere l'esito. Un report bloccato non ferma la preparazione degli altri; sospendi solo i consolidati che dipendono dai suoi dati mancanti, senza inventare valori o dichiararli completi. Arresta l'intero lotto soltanto per un problema comune di sicurezza, integrità o autorizzazione, oppure un impedimento reale a ogni lavoro indipendente rimasto; segnala immediatamente i blocchi che richiedono intervento. Non cambiare manifest, destinatari, delega, calendario o criteri di completezza e invio del lotto: un report mancante non autorizza invii parziali o altri canali. BRAIN_REVIEW richiede conferma umana e non va automatizzato. Non usare campioni globali. Dopo aver verificato tutte le pagine carica ogni PDF con COMMERCIAL_REPORT_ARTIFACT, artifactKey dal manifest: base64 a blocchi di massimo 40000 caratteri numerati da 0, poi finalizza con sha256, fonte, rete, mese e verified=true. Il servizio invia a ciascun responsabile soltanto i report della sua squadra; alle due caselle centrali entrambi i consolidati e tutti gli individuali. Non inviare con altri strumenti. Nessun pagamento/provvigione, appendice fonti/metodi o richiamo separato al CrioGel. Se mancano dati o strumenti, registra il limite sul report interessato e continua il lavoro indipendente consentito. Agente ChatGPT previsto: ${REPORT_AGENT}. Manifest: ${JSON.stringify(batch.manifest)}.\nVersione istruzioni: ${COMMERCIAL_REPORT_INSTRUCTIONS_VERSION}.\n${COMMERCIAL_REPORT_INSTRUCTIONS}`;
}
export async function triggerMonthlyReports(db,{now=new Date(),fetchImpl=fetch,secret=globalThis.process.env.SUPABASE_SERVICE_ROLE_KEY,dispatch=dispatchCommercialReports}={}) {
  const settings=await reportSettings(db),timing=reportPeriod(now,settings?.delivery_day??10);
  if(!settings?.enabled)return {status:'not_due'};
  requireThat(settings.policy_hash===POLICY_HASH,'Il piano richiede nuova approvazione.',409);
  await assertOwner(db,settings.owner_id);
  const queued=must(await db.from('commercial_report_batches').select('id,period,delivery_day').eq('owner_id',settings.owner_id).eq('policy_hash',POLICY_HASH).eq('status','queued'));
  const dueBatches=[];
  for(const batch of queued.filter(batch=>reportDeliveryDue(batch.period,now,batch.delivery_day??10))) {
    if(must(await db.rpc('commercial_report_finish_batch',{p_batch:batch.id}))!==true)dueBatches.push(batch);
  }
  const delivery=dueBatches.length?{status:'dispatch_requested',batchIds:dueBatches.map(batch=>batch.id),dispatch:await dispatch(fetchImpl)}:null;
  if(!timing.due)return delivery||{status:'not_due'};
  const recipients=await loadReportRecipients(db);await workerReady(fetchImpl);
  const previous=must(await db.from('commercial_report_batches').select('id,status').eq('period',timing.period).maybeSingle());
  if(previous) {
    if(delivery)return delivery;
    return {status:'already_triggered',batchId:previous.id,batchStatus:previous.status};
  }
  const batch={id:randomUUID(),period:timing.period,owner_id:settings.owner_id,policy_hash:POLICY_HASH,status:'triggering',delivery_day:settings.delivery_day??10,manifest:buildReportManifest(recipients).targets,recipients_hash:recipientsFingerprint(recipients)};
  const inserted=await db.from('commercial_report_batches').insert(batch);
  if(inserted.error?.code==='23505')return {status:'already_triggered'};
  must(inserted);
  // Never retry ambiguously accepted triggers. Same explicit key is safe if inspected manually.
  try {
    const response=await fetchImpl(`https://api.chatgpt.com/v1/workspace_agents/${settings.trigger_id}/trigger`,{
      method:'POST',headers:{Authorization:'Bearer '+unsealToken(settings.token_encrypted,secret,settings.owner_id),'Content-Type':'application/json','Idempotency-Key':'progre-commercial-'+batch.period,'OpenAI-Beta':'workspace_agent_runs=v1'},
      body:JSON.stringify({conversation_key:'progre-commercial-'+batch.period,input:triggerPrompt(batch)}),signal:AbortSignal.timeout(25000),
    });
    requireThat(response.status===202,'Avvio agente non accettato. Verificare il canale API e la connessione.',502);
    const result=await response.json();
    requireThat(/^https:\/\/chatgpt\.com\/c\//.test(result.conversation_url||''),'Risposta avvio agente non valida.',502);
    must(await db.from('commercial_report_batches').update({status:'requested',conversation_url:result.conversation_url,trigger_run_id:result.agent_trigger_run_id||null}).eq('id',batch.id));
    return {status:'requested',batchId:batch.id,conversationUrl:result.conversation_url};
  } catch(error) {
    await db.from('commercial_report_batches').update({status:'attention'}).eq('id',batch.id);
    throw error;
  }
}
async function authorizedBatch(auth,batchId) {
  requireThat(auth.profile.ruoli?.amministratore_workspace===true,'Piano report riservato al titolare amministratore.',403);
  const settings=await reportSettings(auth.admin);
  requireThat(settings?.enabled&&settings.owner_id===auth.profile.id&&settings.policy_hash===POLICY_HASH,'Nessuna delega mensile attiva per questo utente.',403);
  await assertOwner(auth.admin,auth.profile.id);
  const batch=must(await auth.admin.from('commercial_report_batches').select('*').eq('id',batchId).eq('owner_id',auth.profile.id).maybeSingle());
  requireThat(batch?.policy_hash===POLICY_HASH,'Lotto non accessibile.',404);
  return batch;
}
export async function reportPlan(auth) {
  requireThat(auth.profile.ruoli?.amministratore_workspace===true,'Piano report non accessibile.',403);
  const settings=await reportSettings(auth.admin);
  requireThat(!settings||settings.owner_id===auth.profile.id,'Piano di un altro titolare.',403);
  const batches=must(await auth.admin.from('commercial_report_batches').select('id,period,status,conversation_url,created_at,manifest,delivery_day').eq('owner_id',auth.profile.id).order('created_at',{ascending:false}).limit(6));
  let recipients,contactsError;
  try {recipients=await loadReportRecipients(auth.admin);}catch(error){contactsError=error.message;recipients={individual:[],aggregate:[]};}
  return {enabled:settings?.enabled===true,agents:AGENTS,manifest:!contactsError?buildReportManifest(recipients):null,policyHash:POLICY_HASH,schedule:{day:settings?.delivery_day??2,time:'10:00',timezone:'Europe/Rome',nextDay:settings?.next_delivery_day??null,catchUp:true},batches,recipients,contactsReady:!contactsError,contactsError};
}
export async function reportArtifact(auth,input,{now=new Date(),dispatch=dispatchCommercialReports,schedule=waitUntil}={}) {
  const batch=await authorizedBatch(auth,input.batchId);
  if(input.action==='status') {
    const files=must(await auth.admin.from('commercial_report_files').select('artifact_key,sha256,bytes,pages,verified').eq('batch_id',batch.id));
    const chunks=must(await auth.admin.from('commercial_report_chunks').select('artifact_key,part,total').eq('batch_id',batch.id));
    const missing=batch.manifest.filter(target=>!files.some(file=>file.artifact_key===target.key)).map(target=>{
      const parts=chunks.filter(chunk=>chunk.artifact_key===target.key),total=parts[0]?.total??null;
      return {artifactKey:target.key,name:target.name,total,receivedParts:parts.map(part=>part.part).sort((a,b)=>a-b),missingParts:total===null?null:Array.from({length:total},(_,part)=>part).filter(part=>!parts.some(chunk=>chunk.part===part))};
    });
    return {batch:{id:batch.id,period:batch.period,status:batch.status,manifest:batch.manifest,deliveryDay:batch.delivery_day??10},files,missing,emails:must(await auth.admin.from('commercial_report_emails').select('delivery_key,status,sent_at').eq('batch_id',batch.id))};
  }
  const recipients=await loadReportRecipients(auth.admin);
  requireThat(recipientsFingerprint(recipients)===batch.recipients_hash,'Contatti o collegamenti variati: il lotto richiede revisione.',409);
  requireThat(isDeepStrictEqual(buildReportManifest(recipients).targets,batch.manifest),'Perimetro report variato.',409);
  const target=batch.manifest.find(t=>t.key===input.artifactKey);
  requireThat(target,'Report fuori dal piano approvato.',403);
  requireThat(batch.status==='requested','Lotto già accodato o non disponibile; leggere lo stato prima di ripetere.',409);
  const existing=must(await auth.admin.from('commercial_report_files').select('sha256').eq('batch_id',batch.id).eq('artifact_key',target.key).maybeSingle());
  if(existing){
    requireThat(input.action==='finalize'&&existing.sha256===input.sha256,'Esiste già un PDF per questo report. Leggere lo stato.',409);
    return queueIfComplete(auth,batch,recipients,{now,dispatch,schedule});
  }
  if(input.action==='chunk') {
    requireThat(Number.isInteger(input.part)&&input.part>=0&&input.part<input.total&&input.total<=100&&input.total>0,'Blocco non valido.');
    requireThat(/^[A-Za-z0-9+/=]+$/.test(input.base64||'')&&input.base64.length<=40000,'Contenuto blocco non valido.');
    const old=must(await auth.admin.from('commercial_report_chunks').select('base64,total').eq('batch_id',batch.id).eq('artifact_key',target.key).eq('part',input.part).maybeSingle());
    if(old)requireThat(old.base64===input.base64&&old.total===input.total,'Blocco già presente con contenuto diverso.',409);
    else must(await auth.admin.from('commercial_report_chunks').insert({batch_id:batch.id,artifact_key:target.key,part:input.part,total:input.total,base64:input.base64}));
    return {status:old?'already_stored':'stored',part:input.part};
  }
  requireThat(input.action==='finalize'&&input.verified===true&&input.period===batch.period&&input.network===target.network&&input.source===target.source,'Verifica PDF, periodo, fonte o rete non valida.');
  requireThat(/^[a-f0-9]{64}$/.test(input.sha256||''),'SHA-256 non valido.');
  const chunks=must(await auth.admin.from('commercial_report_chunks').select('part,total,base64').eq('batch_id',batch.id).eq('artifact_key',target.key).order('part'));
  requireThat(chunks.length>0&&chunks.every((c,i)=>c.part===i&&c.total===chunks.length),'Blocchi incompleti.');
  const encoded=chunks.map(c=>c.base64).join(''),bytes=Buffer.from(encoded,'base64');
  requireThat(bytes.length<=MAX_PDF_BYTES&&bytes.subarray(0,5).toString()==='%PDF-'&&bytes.toString('base64')===encoded,'PDF non valido o superiore a 2 MB.');
  requireThat(createHash('sha256').update(bytes).digest('hex')===input.sha256,'Integrità PDF non verificata.');
  const doc=await PDFDocument.load(bytes);requireThat(doc.getPageCount()>=3,'Report incompleto.');
  must(await auth.admin.from('commercial_report_files').insert({batch_id:batch.id,artifact_key:target.key,period:batch.period,network:target.network,source:target.source,filename:`Report_Commerciale_${target.key.replace(/[^a-zA-Z0-9_-]/g,'_')}_${batch.period.slice(0,7)}.pdf`,base64:encoded,sha256:input.sha256,bytes:bytes.length,verified:true,pages:doc.getPageCount()}));
  must(await auth.admin.from('commercial_report_chunks').delete().eq('batch_id',batch.id).eq('artifact_key',target.key));
  return queueIfComplete(auth,batch,recipients,{now,dispatch,schedule});
}
async function queueIfComplete(auth,batch,recipients,{now,dispatch,schedule}) {
  const files=must(await auth.admin.from('commercial_report_files').select('artifact_key,period,network,source,bytes,verified').eq('batch_id',batch.id));
  if(files.length!==batch.manifest.length)return {status:'uploaded',received:files.length,expected:batch.manifest.length};
  const jobs=buildDeliveries(batch.period,recipients,files);
  must(await auth.admin.rpc('commercial_report_queue',{p_batch:batch.id,p_jobs:jobs}));
  const dispatchDue=reportDeliveryDue(batch.period,now,batch.delivery_day??10);
  if(dispatchDue)schedule(dispatch().catch(()=>{
    // Per-envelope statuses preserve ambiguous outcomes; never silently resend.
    console.error('Commercial report dispatch requires review', {batchId:batch.id});
  }));
  return {status:'queued',batchId:batch.id,emails:jobs.length,dispatch:dispatchDue?'dispatch_requested':'waiting_for_10_00'};
}

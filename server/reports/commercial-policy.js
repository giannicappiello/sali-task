import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const AGENTS = Object.freeze([
  ['602.00040','Anna Purpura','prof'],['602.00050','BEAUTY HUB di Barbara Borra','prof'],
  ['602.00013','Concetto Squillaci','prof'],['602.00044','Giuseppe Ciaramella','prof'],
  ['602.00059','Luca Cattelan','prof'],['602.00064','Mario Bruni','prof'],
  ['602.00051','Mauro Chiappari','prof'],['602.00060','Novazzi Alessandro Angelo Carlo','prof'],
  ['602.00063','Raffaella Orizzonte','prof'],['602.00047','Fabio Toma','prof'],
  ['602.00069','Virginio Filippo Abbaticchio','ph'],['602.00052','Pierpaolo Annecchino','ph'],
  ['602.00068','Francesco De Angelis','ph'],['602.00073','Marco Gallotti','ph'],
].map(([code,name,network])=>Object.freeze({code,name,network,source:network==='ph'?'ordiniph':'fatture'})));
export const REPORT_AGENT = 'agt_6aef5e2ab1548191a65ca9d013eba409';
export const AGGREGATE_TO = Object.freeze(['ordini@progre.it','giovanni.cappiello@progre.it']);
export const MAX_PDF_BYTES = 2_000_000;
export const MAX_BATCH_BYTES = 18_000_000;
export const must = r => { if(r.error) throw r.error; return r.data; };
export const requireThat = (condition,message,status=400) => {if(!condition)throw Object.assign(new Error(message),{status});};
const digest = value=>createHash('sha256').update(value).digest('hex');
export const POLICY_HASH = digest(JSON.stringify({agents:AGENTS,aggregate:AGGREGATE_TO,day:10,time:'10:00',zone:'Europe/Rome',version:2,managerScope:'linked-agents-and-own',centralScope:'all-individuals-plus-pr-ph-groups'}));
export const recipientsFingerprint = recipients=>digest(JSON.stringify(recipients));
export function reportPeriod(now=new Date(),deliveryDay=10) {
  requireThat([2,10].includes(deliveryDay),'Giorno invio report non valido.');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  const previous=new Date(Date.UTC(Number(parts.year),Number(parts.month)-2,1));
  return {due:[deliveryDay-1,deliveryDay].includes(Number(parts.day))&&['09','10'].includes(parts.hour),deliveryDue:Number(parts.day)===deliveryDay&&parts.hour==='10',period:previous.toISOString().slice(0,10),month:previous.toLocaleString('it-IT',{month:'long',year:'numeric',timeZone:'UTC'})};
}
export function subject(period) {
  requireThat(/^\d{4}-\d{2}-01$/.test(period),'Mese report non valido.');
  const date=new Date(period+'T00:00:00Z');
  requireThat(Number.isFinite(+date)&&date.toISOString().slice(0,10)===period,'Mese report non valido.');
  return 'Report Commerciale mese di '+date.toLocaleString('it-IT',{month:'long',year:'numeric',timeZone:'UTC'});
}
// Compare Italian calendar time so the approved 10:00 start follows DST.
// There is no expiry: a verified late batch must remain deliverable.
export function reportDeliveryDue(period, now = new Date(), deliveryDay = 10) {
  requireThat([2,10].includes(deliveryDay),'Giorno invio report non valido.');
  subject(period); // Validate the stored reporting month.
  const date = new Date(period + 'T00:00:00Z');
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, deliveryDay)).toISOString().slice(0, 10) + 'T10:00';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` >= start;
}
export function email(value) {
  const normalized=String(value||'').trim().toLowerCase();
  requireThat(/^[^\s@,;<>\r\n]+@[^\s@,;<>\r\n]+\.[^\s@,;<>\r\n]+$/.test(normalized),'Email agente o responsabile mancante/non valida.');
  return normalized;
}
export function resolveRecipients(agents,users) {
  const people=new Map(users.map(u=>[u.id,u]));
  const managers=new Map(),individual=[];
  for(const expected of AGENTS) {
    const record=agents.find(a=>a.codice===expected.code),user=people.get(record?.workspace_utente_id);
    requireThat(record&&record.attivo_mexal!==false&&user?.attivo===true,'Agente selezionato assente o disattivato: '+expected.name);
    // Prefer the current Workspace contact, as for order delivery; never guess.
    const to=email(user.email||record.email);
    individual.push({...expected,to,userId:user.id,managerId:user.responsabile_utente_id||record.responsabile_utente_id||null});
    const managerId=user.responsabile_utente_id||record.responsabile_utente_id;
    if(managerId) {
      const manager=people.get(managerId);
      requireThat(manager?.attivo===true,'Responsabile assente o disattivato per '+expected.name);
      if(!managers.has(managerId))managers.set(managerId,{id:managerId,name:[manager.nome,manager.cognome].filter(Boolean).join(' ')||'Responsabile',to:email(manager.email),agentCodes:[]});
      managers.get(managerId).agentCodes.push(expected.code);
    }
  }
  for(const manager of managers.values()) {
    const own=individual.find(a=>a.userId===manager.id);
    if(own&&!manager.agentCodes.includes(own.code))manager.agentCodes.push(own.code);
    manager.agentCodes.sort();
  }
  return {individual,aggregate:[...AGGREGATE_TO],managers:[...managers.values()]};
}
export function buildReportManifest(recipients) {
  const targets=AGENTS.map(a=>({key:a.code,name:a.name,kind:'agent',network:a.network,source:a.source,agentCodes:[a.code]}));
  for(const network of ['prof','ph'])targets.push({key:'group:'+network,name:'Gruppo '+(network==='ph'?'PH':'PR'),kind:'group',network,source:network==='ph'?'ordiniph':'fatture',agentCodes:AGENTS.filter(a=>a.network===network).map(a=>a.code).sort()});
  const managerReports=[];
  for(const manager of recipients.managers||[]) {
    const keys=[];
    for(const network of ['prof','ph']) {
      const codes=manager.agentCodes.filter(code=>AGENTS.find(a=>a.code===code)?.network===network).sort();
      if(!codes.length)continue;
      const group=targets.find(t=>t.key==='group:'+network);
      if(JSON.stringify(codes)===JSON.stringify(group.agentCodes))keys.push(group.key);
      else {
        const key='manager:'+manager.id+':'+network;
        targets.push({key,name:'Squadra '+manager.name,kind:'manager',network,source:group.source,agentCodes:codes});keys.push(key);
      }
    }
    managerReports.push({...manager,reportKeys:keys});
  }
  return {targets,managers:managerReports};
}
export function buildDeliveries(period,recipients,files) {
  const manifest=buildReportManifest(recipients),keyOf=f=>f.artifact_key||f.agent_code;
  requireThat(files.length===manifest.targets.length&&new Set(files.map(keyOf)).size===manifest.targets.length,'Lotto PDF incompleto o duplicato.');
  requireThat(files.reduce((n,f)=>n+f.bytes,0)<=MAX_BATCH_BYTES,'Allegati riepilogativi oltre 18 MB. Ottimizzare i PDF senza ridurne la leggibilità.');
  for(const expected of manifest.targets) {
    const file=files.find(f=>keyOf(f)===expected.key);
    requireThat(file&&file.period===period&&file.source===expected.source&&file.network===expected.network&&file.verified===true,'PDF non verificato per agente, rete, fonte o mese: '+expected.name);
    requireThat(file.bytes>0&&file.bytes<=MAX_PDF_BYTES,'Dimensione PDF non valida.');
  }
  const title=subject(period);
  const messages=new Map();
  for(const agent of recipients.individual) {
    if(recipients.aggregate.includes(agent.to))continue;
    const row=messages.get(agent.to)||{delivery_key:'individual:'+agent.code,recipient:agent.to,subject:title,body:'In allegato il report commerciale del mese.',artifact_keys:[]};
    row.artifact_keys.push(agent.code);messages.set(agent.to,row);
  }
  for(const manager of manifest.managers) {
    if(recipients.aggregate.includes(manager.to))continue;
    const row=messages.get(manager.to)||{recipient:manager.to,subject:title,artifact_keys:[]};
    row.delivery_key='manager:'+manager.id;row.body='In allegato il riepilogo della tua squadra, con la classifica agenti, e i report individuali degli agenti collegati.';
    row.artifact_keys=[...new Set([...row.artifact_keys,...manager.agentCodes,...manager.reportKeys])];messages.set(manager.to,row);
  }
  return [...messages.values(),{delivery_key:'aggregate',recipient:recipients.aggregate.join(', '),subject:title,body:'In allegato i report consolidati dei gruppi PR e PH, con le classifiche agenti, e tutti i report individuali del mese.',artifact_keys:[...AGENTS.map(a=>a.code),'group:prof','group:ph']}];
}
export function sealToken(token,secret,owner) {
  const key=createHash('sha256').update(secret+'\ncommercial-report-token-v1').digest(),iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(owner));
  const ciphertext=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),ciphertext].map(v=>v.toString('base64url')).join('.');
}
export function unsealToken(value,secret,owner) {
  const [iv,tag,data]=value.split('.').map(s=>Buffer.from(s,'base64url'));
  const decipher=createDecipheriv('aes-256-gcm',createHash('sha256').update(secret+'\ncommercial-report-token-v1').digest(),iv);
  decipher.setAAD(Buffer.from(owner));decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');
}

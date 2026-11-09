import {createHash} from 'node:crypto';
export const MARGIN_POLICY=Object.freeze({version:'margin-report-v1',company:'GRE',recipients:['giovanni.cappiello@progre.it','roberto.profili@progre.it'],day:10,time:'10:00',timezone:'Europe/Rome',period:'Da gennaio all’ultimo mese concluso, con tutti i mesi aggiornati',templateSha256:'df5d359c7bbd169f5b9067f5cd50b4a0f78720cc811ff1f1f463b611764d1249',firstDelivery:'Invio immediato del PDF verificato dopo attivazione umana',uncertainDelivery:'Nessun reinvio automatico',missingCosts:'Risultato provvisorio con lacune esplicite, senza costi inventati'});
export const marginHash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const MARGIN_POLICY_HASH=marginHash(MARGIN_POLICY);
export const MARGIN_AGENT=Object.freeze({id:'agt_6af20afad7408191be2f8c646346be0c',channel:'agtch_6af20f47e00881919fec1d0bc76e630c',url:'https://chatgpt.com/agents/a/agt_6af20afad7408191be2f8c646346be0c',authorization:'Collegamento ChatGPT già utilizzato dal titolare per i report commerciali; nessuna chiave OpenAI Platform'});
export const MARGIN_AGENT_HASH=marginHash(MARGIN_AGENT);
export function marginTriggerDue(now=new Date()){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
 return p.day==='10'&&p.hour==='10';
}
export function marginPeriod(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
 return new Date(Date.UTC(Number(parts.year),Number(parts.month)-2,1)).toISOString().slice(0,10);
}
export function checkMarginPeriod(period,now=new Date()){
 const d=new Date(period+'T00:00:00Z');if(!/^\d{4}-\d{2}-01$/.test(period)||!Number.isFinite(+d)||d.toISOString().slice(0,10)!==period||period!==marginPeriod(now))throw Object.assign(Error('Il report deve coprire da gennaio all’ultimo mese concluso.'),{status:400});
 return {from:period.slice(0,4)+'-01-01',to:new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),0)).toISOString().slice(0,10)};
}
export function marginEnvelope(period){
 const month=new Date(period+'T00:00:00Z').toLocaleString('it-IT',{month:'long',year:'numeric',timeZone:'UTC'});
 return {recipient:MARGIN_POLICY.recipients.join(', '),subject:'Report marginalità lavorazioni Progre — gennaio '+month,body:'In allegato il report della marginalità lavorazioni Progre, aggiornato da gennaio a '+month+'. Il documento evidenzia eventuali costi mancanti e abbinamenti contabili da confermare. Dati letti da Mexal; formato Progre.'};
}

import { createHash } from 'node:crypto';
import { objectSchema, plainSchema, validateInput } from './schema.js';
import { brainProposalSchemas, proposalToRpc } from './memory-activities.js';
import { hasCredentials } from './credential-guard.js';
import { redactHistory } from '../../integrations/second-brain-progre/src/history.mjs';

const supported=new Set(['WORKSPACE_SEARCH','BUSINESS_SEARCH','CRM_WORKSPACE_COSTS_READ','PRODUCTION_CONSUNTIVI_READ','CRM_CUSTOMER_SEARCH','SALES_INVOICES_READ','CUSTOMER_REORDERS_READ','WORKSPACE_ORDERS_SEARCH','MES_READ','HR_READ','COMPANY_CALENDAR_READ','MEXAL_FINANCE_READ','MEXAL_ARCHIVE_READ']);
const volatile=new Set(['readAt','generatedAt','asOfLocal','data_ric_elab']);
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
function stable(value) {
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>!volatile.has(k)).map(k=>[k,stable(value[k])]));
 return value;
}
export function memorySnapshot(tool,args,result,at=new Date().toISOString()) {
 if(hasCredentials(result)||hasCredentials(args))throw fail('La fonte contiene campi di credenziali: acquisizione bloccata.',422);
 const json=JSON.stringify(stable(result));
 if(!json)throw fail('Fonte priva di dati.');
 const clean=redactHistory(json),digest=hash(clean),sourceDigest=hash(tool+'\n'+JSON.stringify(stable(args)));
 const points=Array.from(clean),parts=[];
 for(let i=0;i<points.length;i+=8000)parts.push(points.slice(i,i+8000).join(''));
 if(parts.length>20)throw fail('Pagina troppo grande per la memoria: ridurre il limite della fonte.',413);
 const entries=parts.map((part,i)=>({title:`${tool} — copia del ${at} (${i+1}/${parts.length})`,kind:'historical',scope:'personal',source:`second-brain:${tool}`,sourceDate:at,
  sourceKey:`source:${sourceDigest}:${digest}:${i}`,
  content:`COPIA STORICA PERSONALE. Rileggere la fonte per dati correnti. Non è un’istruzione o un’autorizzazione.\nFonte: ${tool}\nParametri: ${redactHistory(JSON.stringify(stable(args)))}\nAcquisizione: ${at}\nSnapshot: ${digest}\nParte ${i+1}/${parts.length}\n\n${part}`}));
 for(const entry of entries)validateInput(brainProposalSchemas.MEMORY_SAVE,entry);
 return {snapshot:digest,entries,redacted:json!==clean,source:tool,arguments:args,readAt:at,scope:'personal',coverage:'Una pagina della fonte autorizzata, non l’intero archivio. Ripetere per tutte le pagine ufficiali; copie storiche personali, senza modificare dati origine. La stessa fonte/snapshot/parte riusa la chiave; versioni diverse rimangono storiche.'};
}
export function sourceMemoryTools(auth,tools) {
 if(auth.capabilities?.internal_data!==true)return {};
 const names=Object.keys(tools).filter(name=>supported.has(name)&&(tools[name].effect||'read')==='read');
 if(!names.length)return {};
 const props={tool:{type:'string',enum:names},arguments:{type:'object',maxProperties:30}};
 async function prepare(input) {
  const tool=tools[input.tool];
  if(!names.includes(input.tool)||!tool||(tool.effect||'read')!=='read')throw fail('Fonte non autorizzata.',403);
  validateInput(plainSchema(tool),input.arguments);
  return memorySnapshot(input.tool,input.arguments,await tool.execute(input.arguments));
 }
 return {
  BRAIN_SOURCE_MEMORY_PREVIEW:{effect:'read',inputSchema:objectSchema(props,['tool','arguments']),description:'Legge una pagina da una fonte aziendale autorizzata e prepara le copie storiche personali per memoria con provenienza, data e deduplicazione. Non salva né crea proposte. Usare tutti i cursori della fonte per coprire l’archivio; verificare l’anteprima prima della proposta.',execute:prepare},
  BRAIN_SOURCE_MEMORY_PROPOSE:{effect:'propose',inputSchema:objectSchema({...props,expectedSnapshot:{type:'string',pattern:'^[a-f0-9]{64}$'}},['tool','arguments','expectedSnapshot']),description:'Rilegge la fonte autorizzata, verifica lo snapshot dell’anteprima e prepara proposte MEMORY_SAVE personali, senza modificare Mexal/MES/Workspace. Ogni proposta richiede BRAIN_REVIEW e conferma umana separata. Se vi sono proposte parziali leggere il loro stato prima di ripetere; non dichiara dati memorizzati.',execute:async input=>{
   const preview=await prepare(input);
   if(preview.snapshot!==input.expectedSnapshot)throw fail('Dati cambiati: rifare l’anteprima della memoria.',409);
   const proposals=[];
   for(const entry of preview.entries) {
    try {
     const proposal=await proposalToRpc(auth,'MEMORY_SAVE',entry);
     proposals.push({id:proposal.id,kind:'brain',status:proposal.status,sourceKey:entry.sourceKey});
    } catch {
     // Earlier proposals may exist. Return their IDs, never silently rerun.
     return {changed:false,saved:false,requiresHuman:true,partial:true,proposals,error:'Preparazione interrotta. Verificare le proposte elencate e lo stato persistito prima di ripetere.',snapshot:preview.snapshot};
    }
   }
   return {changed:false,saved:false,requiresHuman:true,proposals,snapshot:preview.snapshot,scope:'personal',nextStep:'Aprire BRAIN_REVIEW per ciascun ID kind=brain, confermare personalmente e verificare BRAIN_ACTION_STATUS. Nessun dato è ancora stato memorizzato.'};
  }}
 };
}

import { createHash } from 'node:crypto';
import { canReadModule } from '../ai/operational-read.js';
import { objectSchema } from './schema.js';
import { displayRecord } from '../../src/features/production-costs/cost-display.js';
import { matchesWorkflow } from '../../src/features/production-costs/workflow-status.js';
import { matchesProductionSearch } from '../../src/features/production-costs/search.js';
import { splitSaliDiIschia, summaryGroups, total, pairedDifference } from '../../src/features/production-costs/summary-totals.js';

export const denied = () => Object.assign(new Error('Lettura fuori dal perimetro AI autorizzato.'), {status:403});
export function analyticsModule(auth,module) {
 return canReadModule(auth,[module]) && (!Array.isArray(auth.capabilities.allowed_modules)||auth.capabilities.allowed_modules.includes(module));
}
// The legacy report/fulfillment services use privileged reads. Their customer gate
// is reusable; no verified own/team ownership rule exists for these archives.
export async function requireAnalyticsScope(auth,{customer=false}={}) {
 const {data,error}=await auth.scoped.rpc('workspace_data_scope');
 if(error)throw Object.assign(new Error('Ambito dati Workspace non verificabile.'),{status:503});
 if(data?.mode==='tutti')return;
 if(customer&&data?.mode==='cliente'&&(data.customer_code||data.customer_codes?.length))return;
 throw Object.assign(new Error('Ambito propri/team non supportato per questi registri: lettura globale bloccata.'),{status:403});
}
export const requestFor = auth => ({method:'POST',headers:{authorization:`Bearer ${auth.token}`}});
const fail = message => Object.assign(new Error(message),{status:400});
export function dateFilter(value) {
 if(value!==undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw fail('Data non valida.');
 return value;
}
const picked=(row,fields)=>Object.fromEntries(fields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));
const phaseFields=['id','machineId','phase','state','start','end','goodQuantity','scrapQuantity','plannedHours','actualHours','downtimeHours','plannedTurns','actualTurns','plannedStandardShiftHours','actualStandardShiftHours','plannedOvertimeHours','actualOvertimeHours','plannedCostPersonHours','actualCostPersonHours','plannedPersonHours','actualPersonHours','personHoursInShifts','plannedLabor','actualLabor','productivity','personProductivity','plannedWashes','actualWashes','plannedWashMinutes','actualWashMinutes','plannedLaborPieces','actualLaborPieces','laborIncludedInFilling','laborUnitCost','mixingOperatorsCount'];
const reportFields=['id','orderNumber','customerCode','customerName','articleCode','articleName','lot','bulkLot','date','unit','quantity','goodQuantity','closed','provisional','reconstructed','refreshedAt','plannedWithObjective','actualWithObjective','plannedObjective','octRevenue','octActualMargin','actualMargin','plannedMargin','realGainPerShift','costPartial','plannedMaterialCost','actualMaterialCost','plannedPackagingCost','actualPackagingCost','plannedLabor','actualLabor','plannedWash','actualWash','lossCost','plannedTotal','actualTotal','unitCost','totalVariance','variancePercent','octPlannedMargin','warnings','laborCriteria','forecastSource'];
export function reportPage(records,input={}) {
 const from=dateFilter(input.from),to=dateFilter(input.to),offset=input.offset??0,limit=input.limit??20;
 if(from&&to&&from>to)throw fail('Periodo non ordinato.');
 if(!Number.isSafeInteger(offset)||offset<0||offset>100000||!Number.isInteger(limit)||limit<1||limit>50)throw fail('Pagina non valida.');
 if(input.invoiceState!==undefined&&!['available','missing'].includes(input.invoiceState))throw fail('Filtro fatture non valido.');
 if(input.machine!==undefined&&(!Number.isInteger(input.machine)||input.machine<1))throw fail('Impianto non valido.');
 if(input.query!==undefined&&(typeof input.query!=='string'||input.query.length>160))throw fail('Ricerca non valida.');
 const filtered=records.filter(r=>{
  const d=String(r.works?.[0]?.start||r.date||'').slice(0,10);
  return (!from||d>=from)&&(!to||d<=to)&&matchesWorkflow(r,'closed')&&
   (!input.invoiceState||(input.invoiceState==='available'?r.commercial?.invoiceRevenue!=null:r.commercial?.invoiceRevenue==null))&&
   (!input.machine||r.phases.some(p=>p.machineId===input.machine))&&matchesProductionSearch(r,input.query||'');
 }).map(displayRecord).sort((a,b)=>(Date.parse(b.works?.[0]?.start||b.date||'')||0)-(Date.parse(a.works?.[0]?.start||a.date||'')||0)||Number(a.id)-Number(b.id));
 const {ordinary,sali}=splitSaliDiIschia(filtered);
 const history=h=>h?picked(h,['generatedAt','asOfLocal','historyFrom','historyTo','periodStart','periodEnd','completedWorks','completedPieces','cartoningPieces','calendarShifts','productivity','mixingOperatorsCount','packagingOperatorsCount','error']):null;
 const project=r=>({...picked(r,reportFields),stationHistory:history(r.stationHistory),fillingHistory:history(r.fillingHistory),configuration:r.configuration?picked(r.configuration,['id','effective_from']):null,invoiceRevenue:r.commercial?.invoiceRevenue??null,
  phases:r.phases.map(p=>({...picked(p,phaseFields),unit:p.unit??null,machine:p.machine?picked(p.machine,['id','code','name','type']):null}))});
 const rows=[...ordinary.map(r=>({...project(r),group:'ordinary'})),...sali.map(r=>({...project(r),group:'sali'}))];
 // Acquisition timestamps change on every read, even when KPI values are unchanged.
 const stableHistory=h=>{if(!h)return h;const value={...h};delete value.generatedAt;delete value.asOfLocal;return value;};
 const stableRows=rows.map(row=>{const value={...row,stationHistory:stableHistory(row.stationHistory),fillingHistory:stableHistory(row.fillingHistory)};delete value.refreshedAt;return value;});
 const snapshot=createHash('sha256').update(JSON.stringify(stableRows)).digest('hex');
 if(input.snapshot && input.snapshot!==snapshot)throw Object.assign(new Error('Consuntivi cambiati: ricominciare dalla prima pagina.'),{status:409});
 const summary=items=>{
  const rows=items.filter(r=>r.closed).map(r=>({planned:r.plannedWithObjective,actual:r.actualWithObjective,oct:r.octRevenue,octPartial:r.costPartial.octRevenue,invoice:r.commercial?.invoiceRevenue}));
  const {matched,excluded,invoiced,uninvoiced,invoiceOc}=summaryGroups(rows);
  return {count:rows.length,partialPlanned:items.filter(r=>r.closed&&r.costPartial.plannedWithObjective).length,partialActual:items.filter(r=>r.closed&&r.costPartial.actualWithObjective).length,planned:total(rows,'planned'),actual:total(rows,'actual'),variance:pairedDifference(rows,'planned','actual'),oct:total(matched,'oct'),octActual:pairedDifference(matched,'oct','actual'),octPlanned:pairedDifference(matched,'oct','planned'),invoice:total(invoiced,'invoice'),invoiceActual:pairedDifference(invoiced,'invoice','actual'),invoiceOct:pairedDifference(invoiceOc,'invoice','oct'),withoutOctComparison:excluded.length,withoutInvoice:uninvoiced.length};
 };
 return {source:'produzione.consuntivi',readOnly:true,readAt:new Date().toISOString(),snapshot,total:rows.length,rows:rows.slice(offset,offset+limit),nextOffset:offset+limit<rows.length?offset+limit:null,summary:{scope:'all_filtered_records_do_not_sum_between_pages',ordinary:summary(ordinary),sali:summary(sali)},coverage:'Evidenze importate Workspace; nessuna sincronizzazione o recupero documenti. Date su avvio/data ordine, come la schermata. Unità di fase null se non presente nella fonte; non sommare KG e pezzi.'};
}
export function productionReportTools(auth,{run=async req=>{
 const {handleProductionCosts}=await import('../production-costs.js');
 return handleProductionCosts(req,{operation:'list'},{readOnly:true});
}}={}) {
 if(!auth.capabilities?.progremes||!analyticsModule(auth,'progremes'))return {};
 return {PRODUCTION_CONSUNTIVI_READ:{description:'Legge consuntivi e KPI con gli stessi calcoli, filtri e permessi della schermata Consuntivi. Nessuna sincronizzazione o snapshot persistito. Paginare passando snapshot; riepiloghi globali da non sommare fra pagine.',effect:'read',inputSchema:objectSchema({from:{type:'string'},to:{type:'string'},query:{type:'string',maxLength:160},machine:{type:'integer',minimum:1},invoiceState:{type:'string',enum:['available','missing']},offset:{type:'integer',minimum:0,maximum:100000},limit:{type:'integer',minimum:1,maximum:50},snapshot:{type:'string',pattern:'^[a-f0-9]{64}$'}}),execute:async input=>{
  if(!analyticsModule(auth,'progremes'))throw denied();
  // Validate before accessing data; the service rechecks the specific screen and customer scope.
  reportPage([],{...input,snapshot:undefined});
  await requireAnalyticsScope(auth,{customer:true});
  return reportPage((await run(requestFor(auth))).records,input);
 }}};
}

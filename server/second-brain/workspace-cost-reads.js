import { canReadModule } from '../ai/operational-read.js';
import { objectSchema, uuidSchema } from './schema.js';
import { dateFilter, denied } from './production-report-reads.js';

// Same archive as CRM Rendicontazione. The caller's JWT applies existing RLS;
// stored amounts are returned, never recomputed from hours or rates.
export function workspaceCostReadTools(auth) {
 if (!canReadModule(auth,['crm_conto_terzi']) ||
     (Array.isArray(auth.capabilities.allowed_modules) && !auth.capabilities.allowed_modules.includes('crm_conto_terzi'))) return {};
 return {CRM_WORKSPACE_COSTS_READ:{effect:'read',
  description:'Legge i costi consuntivi registrati per progetti e task nella Rendicontazione CRM PRIVATE, con RLS e permessi della schermata. Importi memorizzati, ore e tariffe; nessun ricalcolo o scrittura. Paginare fino a nextOffset=null. Non è Consuntivi produzioni.',
  inputSchema:objectSchema({from:{type:'string',format:'date'},to:{type:'string',format:'date'},projectId:uuidSchema,phaseId:uuidSchema,offset:{type:'integer',minimum:0,maximum:100000}}),
  execute:async input=>{
   const from=dateFilter(input.from),to=dateFilter(input.to),offset=input.offset??0;
   if ((from&&to&&from>to)||!Number.isSafeInteger(offset)||offset<0||offset>100000) throw Object.assign(Error('Periodo o pagina non validi.'),{status:400});
   const {data:level,error:accessError}=await auth.scoped.rpc('workspace_screen_level_for_user',{target_user_id:auth.profile.id,target_screen:'crm.conto_terzi.rendicontazione'});
   if(accessError)throw Object.assign(Error('Permesso schermata non verificabile.'),{status:503});
   if(!['lettura','scrittura','gestione','completo','amministrazione'].includes(level))throw denied();
   let q=auth.scoped.from('crm_workspace_costs').select('id,project_id,phase_id,cost_date,description,amount,cost_type,hours,hourly_rate,operator_name,created_at').order('cost_date',{ascending:false}).order('id');
   if(from)q=q.gte('cost_date',from);if(to)q=q.lte('cost_date',to);
   if(input.projectId)q=q.eq('project_id',input.projectId);if(input.phaseId)q=q.eq('phase_id',input.phaseId);
   const {data,error}=await q.range(offset,offset+50);if(error)throw error;
   return {source:'crm_workspace_costs',readOnly:true,readAt:new Date().toISOString(),rows:(data||[]).slice(0,50),nextOffset:data?.length>50?offset+50:null,coverage:'Soli costi registrati visibili con RLS personali. Filtri projectId/phaseId sui riferimenti diretti; per le task di un progetto usare BUSINESS_SEARCH. Nessun KPI ricostruito.'};
  }
 }};
}

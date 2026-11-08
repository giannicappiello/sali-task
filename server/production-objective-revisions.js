import {createHash} from 'node:crypto';
import {costSession} from './production-action-session.js';
import {readAllRows} from './private-orders-workbench.js';
import {applicableConfiguration} from '../src/features/production-costs/history.js';
import {stationObjective} from '../src/features/production-costs/station-objective.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const objectiveHash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const objectiveRevisionSchema={type:'object',additionalProperties:false,required:['expectedSnapshot','reason'],properties:{expectedSnapshot:{type:'string',pattern:'^[a-f0-9]{64}$'},reason:{type:'string',minLength:5,maxLength:500},rollbackOf:{type:'string',format:'uuid'}}};

// Preview reads only original evidence/configurations. No MES refresh, price
// recovery, duration invention or rewrite of an accounting snapshot is allowed.
export function objectivePreview(records,configurations,adjustments,{rollbackOf}={}) {
 const items=[],excluded=[];
 for(const row of [...records].sort((a,b)=>a.mes_order_id-b.mes_order_id)){
  const e=row.evidence,works=(e.works||[]).filter(w=>w.state!=='Annullato');
  if(!works.length||!works.every(w=>w.state==='Terminato'))continue;
  const audit=adjustments.filter(a=>a.mes_order_id===row.mes_order_id).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id)));
  const previous=audit.find(a=>Object.hasOwn(a.details||{},'objectiveRevision'))?.details.objectiveRevision??null;
  const override=!e.baseline?audit.find(a=>a.details?.configurationId)?.details.configurationId:null;
  const config=configurations.find(c=>c.id===(override||row.configuration_id))||applicableConfiguration(e,configurations);
  const base={id:row.mes_order_id,orderNumber:e.orderNumber};
  let after,reason;
  if(rollbackOf){
   const source=audit.find(a=>a.details?.objectiveActionId===rollbackOf);
   if(!source)continue;
   if(audit.find(a=>Object.hasOwn(a.details||{},'objectiveRevision'))?.id!==source.id){excluded.push({...base,reason:'Versione successiva presente: rollback bloccato.'});continue;}
   after=source.details.objectiveBackup.previousVersion??null;
  }else{
   const bulk=works.filter(w=>w.phase==='Semilavorato');
   const machine=config?.settings?.machines?.find(m=>Number(m.id)===Number(bulk[0]?.machineId));
   const raw=e.baseline?.stationObjectives?.find(x=>Number(x.machineId)===Number(bulk[0]?.machineId))?.objectivePerWork??machine?.gainPerWork??machine?.gainPerShift;
   const gain=raw!==null&&raw!==undefined&&raw!==''?Number(raw):NaN;
   const candidate=stationObjective({...e,phases:bulk,plannedObjective:Number.isFinite(gain)&&gain>=0?gain*bulk.length:null});
   if(!candidate.objectiveBasis?.historical)reason='Durata e revisione formula storiche non congelate: nessuna sostituzione con parametri correnti.';
   else if(candidate.plannedObjectivePerTurn===null)reason=candidate.objectiveWarning||'Margine obiettivo configurato non disponibile.';
   else after={...candidate,calculationVersion:1,plannedObjective:gain*bulk.length};
   if(previous&&after&&objectiveHash(previous)===objectiveHash(after))reason='Versione già ricalcolata con gli stessi dati.';
  }
  if(reason){excluded.push({...base,reason});continue;}
  items.push({...base,configurationId:config?.id??null,expectedAssignedConfigurationId:row.configuration_id??null,expectedEvidence:e,expectedConfiguration:config??null,
   expectedAdjustmentIds:audit.map(a=>a.id).sort(),before:previous,after,
   difference:{objectiveTotal:0,objectivePerTurnBefore:previous?.plannedObjectivePerTurn??null,objectivePerTurnAfter:after?.plannedObjectivePerTurn??null},
   backup:{evidence:e,configuration:config??null,previousVersion:previous}});
 }
 const summary={eligible:items.length,excluded:excluded.length,objectiveTotalDifference:0,pricesChanged:0,durationsChanged:0};
 const payload={calculationVersion:1,rollbackOf:rollbackOf??null,items,excluded,summary};
 return {...payload,snapshot:objectiveHash(payload),readOnly:true,
  versioning:'Nuove revisioni append-only in production_cost_adjustments; evidenze e configurazioni originali immutate.',
  backup:'Copia integrale di evidenza, configurazione e versione precedente nel riepilogo approvato e in ogni revisione. Verifica di uguaglianza sotto lock prima di scrivere.',
  rollback:'Nuova proposta con rollbackOf uguale all’ID azione; ripristino della versione precedente senza cancellazioni. Bloccato se esistono revisioni successive.'};
}

export async function readObjectivePreview(auth,input={}, {sessionFactory=costSession}={}) {
 const session=await sessionFactory({headers:{authorization:`Bearer ${auth.token}`}},'produzione.consuntivi',true);
 if(session.scope?.mode!=='tutti')throw fail('Il ricalcolo storico richiede un ambito tutti verificato.',403);
 const permission=await auth.scoped.rpc('company_mes_ai_can_write');
 if(permission.error||permission.data!==true)throw fail('Permesso operativo MES non verificato.',403);
 const [records,configs,adjustments]=await Promise.all([
  readAllRows(()=>session.admin.from('production_cost_records').select('*').order('mes_order_id')),
  readAllRows(()=>session.admin.from('production_cost_configurations').select('*').order('id')),
  readAllRows(()=>session.admin.from('production_cost_adjustments').select('*').order('id'))]);
 return objectivePreview(records,configs,adjustments,input);
}
export async function prepareObjectiveRevision(auth,input){
 const preview=await readObjectivePreview(auth,input);
 if(preview.snapshot!==input.expectedSnapshot)throw fail('Anteprima cambiata: rileggerla prima di proporre.',409);
 if(!preview.items.length)throw fail('Nessun documento storico eleggibile. Consultare le esclusioni.');
 return {...input,preview};
}
export async function applyObjectiveRevision(auth,pending){
 // The human-approved audit and original rows are rechecked atomically by SQL.
 if(!['confirmed','executed'].includes(pending.status)||pending.user_id!==auth.profile.id)throw fail('Conferma umana della propria proposta richiesta.',403);
 const current=await readObjectivePreview(auth,pending.payload_summary);
 if(pending.status!=='executed'&&(current.snapshot!==pending.payload_summary.expectedSnapshot||objectiveHash(current)!==objectiveHash(pending.payload_summary.preview)))throw fail('Anteprima modificata: ricalcolo non eseguito. Rigenerare la proposta.',409);
 const {data,error}=await auth.admin.rpc('production_objective_apply_revision',{p_action:pending.id,p_user:auth.profile.id});
 if(error)throw error;
 return {action:data,failure:null};
}

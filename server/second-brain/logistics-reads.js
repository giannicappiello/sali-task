import { preparationSession, checked } from '../order-preparation-auth.js';
import { preparationAuditPage } from '../../shared/preparationAudit.js';
import { objectSchema, uuidSchema } from './schema.js';
import { analyticsModule, denied, requestFor, requireAnalyticsScope } from './production-report-reads.js';

const bad=()=>Object.assign(new Error('Cursore o filtro non valido.'),{status:400});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const statuses=['draft','verified','exporting','uncertain','completed','cancelled'];
export function logisticsReadTools(auth,{authorize=preparationSession}={}) {
 if(!analyticsModule(auth,'allestisci_ordini'))return {};
 const session=async()=>{
  if(!analyticsModule(auth,'allestisci_ordini'))throw denied();
  await requireAnalyticsScope(auth);
  return authorize(requestFor(auth)); // Same internal-user, screen and fulfillment checks as the UI.
 };
 return {
 LOGISTICS_PREPARATIONS_READ:{effect:'read',description:'Elenca preparazioni logistica già registrate. Stessi permessi di Allestisci Ordini; nessuna sincronizzazione Mexal. Passare asOf e nextAfter alle pagine successive. Stato corrente, non snapshot transazionale.',inputSchema:objectSchema({after:uuidSchema,asOf:{type:'string',format:'date-time'},status:{type:'string',enum:statuses}}),execute:async(input={})=>{
  if((input.after&&!uuid(input.after))||(input.asOf&&!iso(input.asOf))||(input.status&&!statuses.includes(input.status)))throw bad();
  if(input.after&&!input.asOf)throw bad();
  const {db}=await session(),asOf=input.asOf||new Date().toISOString();
  let q=db.from('warehouse_order_preparations').select('id,status,version,created_at,updated_at,source,state').lte('created_at',asOf).order('id').limit(51);
  if(input.after)q=q.gt('id',input.after);
  if(input.status)q=q.eq('status',input.status);
  const rows=checked(await q)||[];
  return {source:'warehouse_order_preparations',readOnly:true,asOf,rows:rows.slice(0,50).map(r=>({id:r.id,status:r.status,version:r.version,createdAt:r.created_at,updatedAt:r.updated_at,order:r.source?.reference||r.source?.number||null,packages:r.state?.packages?.length??null,pallets:r.state?.pallets?.length??null})),nextAfter:rows.length>50?rows[49].id:null,coverage:'Stato corrente; asOf esclude nuove preparazioni, non congela modifiche successive. Nessun elenco ordini Mexal né tempo di lavoro misurato.'};
 }},
 LOGISTICS_PREPARATION_REGISTER_READ:{effect:'read',description:'Legge il registro immutabile di una preparazione con ricostruzione delle correzioni uguale al registro UI. Passare maxId e nextAfter fino a null. ID operatori pseudonimi; non contiene ore lavorate.',inputSchema:objectSchema({id:uuidSchema,after:{type:'integer',minimum:0},maxId:{type:'integer',minimum:0}},['id']),execute:async({id,after=0,maxId})=>{
  if(!uuid(id)||!integer(after)||(maxId!==undefined&&(!integer(maxId)||maxId<after))||(after>0&&maxId===undefined))throw bad();
  const {db}=await session();
  const row=checked(await db.from('warehouse_order_preparations').select('id').eq('id',id).maybeSingle());
  if(!row)throw Object.assign(new Error('Preparazione non disponibile.'),{status:404});
  if(maxId===undefined){const latest=checked(await db.from('warehouse_preparation_events').select('id').eq('preparation_id',id).order('id',{ascending:false}).limit(1));maxId=latest[0]?.id||0;}
  if(!integer(maxId))throw bad();
  const events=checked(await db.from('warehouse_preparation_events').select('id,event_id,event_type,actor,payload,created_at').eq('preparation_id',id).gt('id',after).lte('id',maxId).order('id').limit(101))||[];
  const prior=after?checked(await db.from('warehouse_preparation_events').select('payload').eq('preparation_id',id).lte('id',after).not('payload->state','is',null).order('id',{ascending:false}).limit(1)):[];
  const page=events.slice(0,100);
  const records=preparationAuditPage(page,{previousState:prior[0]?.payload.state}).map(r=>({id:r.id,eventId:r.eventId,at:r.at,actor:r.actor,operation:r.operation,readings:r.readings.map(s=>({id:s.id,code:s.code,quantity:s.quantity,previousQuantity:s.previousQuantity,action:s.action,at:s.at,actor:s.actor,mode:s.mode,packageNumber:s.packageNumber,palletNumber:s.palletNumber})),packingChanges:r.packingChanges}));
  return {source:'warehouse_preparation_events',readOnly:true,id,maxId,records,nextAfter:events.length>100?page.at(-1).id:null,readAt:new Date().toISOString(),coverage:'Registro eventi fino a maxId. Intervalli fra eventi = tempo trascorso, non ore/uomo o tempo attivo. Correzioni/rimozioni non sono nuovi pezzi preparati.'};
 }}
 };
}

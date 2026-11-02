import {createHash} from 'node:crypto';
import {assert} from '../shared/orderPreparation.js';
import {verifyOrphanDdtForDeletion,unwrap} from './order-preparation-mexal.js';
import {checked} from './order-preparation-auth.js';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function deletionRequestId(row) {
  const h=digest(['delete-orphan-bcf-v1',row.id,row.export_token]).slice(0,32);
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
async function noDispatch(db,row) {
  for(const table of ['warehouse_preparation_documents','warehouse_shipment_emails','warehouse_print_jobs']) {
    assert(!checked(await db.from(table).select('*').eq('preparation_id',row.id).limit(1)).length,'Documenti, invii o stampe già registrati: cancellazione automatica bloccata.',409);
  }
}
export async function previewOrphanDdtDeletion({db,client,row,actual}) {
  assert(actual,'Nessuna bolla da eliminare rintracciata.',409);
  await noDispatch(db,row);
  const order=await client.getJson('/documenti/ordini-clienti/'+encodeURIComponent(row.source.reference));
  verifyOrphanDdtForDeletion(actual,row,order); // Strictly proves an orphan with identical rows, quantities, lots and unchanged source.
  actual=unwrap(actual);
  const reference=`BC+${actual.serie}+${actual.numero}+${actual.cod_conto}`;
  const fingerprint=digest({id:row.id,version:row.version,exportToken:row.export_token,actual,order:unwrap(order)});
  return {reference,series:Number(actual.serie),number:Number(actual.numero),hash:fingerprint,order:row.source.reference,version:row.version};
}
export async function deleteOrphanDdt({db,client,row,actor,actual,hash,reference,findExisting}) {
  assert(row.status==='uncertain','Nessuna emissione da recuperare.',409);
  await noDispatch(db,row);
  const requestId=deletionRequestId(row);
  let claim=checked(await db.from('warehouse_preparation_events').select('*').eq('preparation_id',row.id).eq('event_id',requestId).maybeSingle());
  let transportError;
  if(!claim) {
    const plan=await previewOrphanDdtDeletion({db,client,row,actual});
    assert(plan.hash===hash && plan.reference===reference,'La bolla o l’ordine sono cambiati: ripeti la verifica.',409);
    const payload={reference:plan.reference,exportToken:row.export_token,hash:plan.hash,document:unwrap(actual),reason:'Cancellazione bolla senza collegamento nativo e nuova emissione richiesta dall’operatore'};
    const inserted=await db.from('warehouse_preparation_events').insert({preparation_id:row.id,event_id:requestId,event_type:'orphan_ddt_delete_requested',actor,payload});
    assert(!inserted.error,'Cancellazione già acquisita o registro non disponibile: aggiorna e verifica l’esito.',409);
    claim={payload,actor};
    try {await client.deleteJson('/documenti/movimenti-magazzino/'+encodeURIComponent(plan.reference));}
    catch(error){transportError=error.message;}
  }
  assert(claim.actor===actor && claim.payload.reference===reference,'Richiesta di recupero non corrispondente.',409);
  let absent=false;
  try {await client.getJson('/documenti/movimenti-magazzino/'+encodeURIComponent(reference));}
  catch(error){if(error.status===404) absent=true;else throw error;}
  assert(absent,transportError || 'La bolla è ancora presente in Mexal. Nessuna seconda cancellazione eseguita.',409);
  assert(!await findExisting(),'Una bolla corrisponde ancora all’allestimento: emissione bloccata.',409);
  // A retry after a lost DELETE response can only read back the result, never repeat DELETE.
  const order=await client.getJson('/documenti/ordini-clienti/'+encodeURIComponent(row.source.reference));
  verifyOrphanDdtForDeletion(claim.payload.document,row,order);
  const evidence={reference,documentAbsent:true,searchEmpty:true,checkedAt:new Date().toISOString()};
  return checked(await db.rpc('warehouse_reopen_deleted_ddt',{p_id:row.id,p_version:row.version,p_actor:actor,p_request:requestId,p_evidence:evidence}));
}

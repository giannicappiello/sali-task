import {Buffer} from 'node:buffer';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {assert} from '../shared/orderPreparation.js';
import {checked,SCREEN} from './order-preparation-auth.js';
import {createProgremesReadonlyAdmin} from './progremes-readonly-auth.js';
import {buildMexalClient} from './mexal/sync-products.js';
import {existingDdt,mutate} from './order-preparation-handler.js';
import {verifyDdt} from './order-preparation-mexal.js';
import {finalizeShipment} from './preparation-dispatch.js';
import {createMesDdtPrinting} from './ddt-mes-print.js';

export const completionWorkerToken=secret=>createHmac('sha256',secret).update('warehouse-ddt-completion').digest('hex');
export function completionAuthorized(req,secret=globalThis.process?.env?.SUPABASE_SERVICE_ROLE_KEY) {
  const token=String(req.headers?.authorization || '').replace(/^Bearer /i,'');
  return !!secret && /^[a-f0-9]{64}$/.test(token) && timingSafeEqual(Buffer.from(token),Buffer.from(completionWorkerToken(secret)));
}
export function automaticPrintId(row,kind) {
  const h=createHash('sha256').update(`automatic-shipment-print:${row.id}:${row.export_token}:${kind}`).digest('hex').slice(0,32);
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export async function completePreparation({db,row,client,printing=createMesDdtPrinting(),finalize=finalizeShipment}) {
  const actor=row.updated_by;
  const operator=checked(await db.from('utenti').select('id,attivo').eq('id',actor).single());
  assert(operator.attivo!==false,'Operatore non più abilitato.',403);
  assert(checked(await db.rpc('workspace_screen_permission_for_user',{target_user_id:actor,target_screen:SCREEN,permission_code:'warehouse.fulfillment.write'}))===true,'Permesso logistica revocato.',403);
  if(['exporting','uncertain'].includes(row.status)) {
    const actual=await existingDdt(client,row);
    assert(actual,'Documento non ancora leggibile: controllo automatico in attesa.',409);
    row=await mutate(db,row,actor,'finish',{token:row.export_token,ddt:verifyDdt(actual,row,row.export_payload),confirmedDocument:actual});
  }
  assert(row.status==='completed','Emissione rifiutata o preparazione riaperta: nessun reinvio automatico.',409);
  const result=await finalize(db,client,row);
  assert(!result.warning,result.warning || 'Documenti da completare.',503);
  await printing.inventory(db);
  const kinds=['bcf_print',...row.state.pallets.map(pallet=>'packing_pallet_'+pallet.id)];
  for(const kind of kinds) {
    let jobs=checked(await db.from('warehouse_print_jobs').select('*').eq('preparation_id',row.id).eq('document_kind',kind).order('created_at',{ascending:false}));
    if(!jobs.length) jobs=[checked(await db.rpc('warehouse_enqueue_print_copies',{p_id:row.id,p_request:automaticPrintId(row,kind),p_kind:kind,p_actor:actor,p_copies:kind==='bcf_print'?3:1}))];
    // A completed initial request is sufficient; later explicit reprints are independent.
    if(jobs.some(job=>job.status==='submitted')) continue;
    for(const job of jobs.slice(0,1)) {
      assert(!['failed'].includes(job.status),'Stampa non riuscita: verifica la stampante in Configurazioni DDT.',409);
      const current=job.status==='submitted'?job:await printing.sync(db,job.id);
      assert(current.status==='submitted','Stampa acquisita: attendo automaticamente l’esito dell’agente.',503);
    }
  }
  return row;
}
export function createCompletionWorker({adminFactory=createProgremesReadonlyAdmin,clientFactory=buildMexalClient,authorize=completionAuthorized,complete=completePreparation}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(req.method!=='POST')return res.status(405).json({error:'Metodo non consentito.'});
    if(!authorize(req))return res.status(401).json({error:'Worker non autorizzato.'});
    const db=adminFactory(),results=[];
    try {
      for(let i=0;i<3;i++) {
        const job=checked(await db.rpc('warehouse_completion_claim',{}));if(!job)break;
        let error=null,blocked=false;
        try {
          const row=checked(await db.from('warehouse_order_preparations').select('*').eq('id',job.preparation_id).single());
          assert(row.export_token===job.export_token,'Tentativo sostituito: nessuna emissione eseguita.',409);
          await complete({db,row,client:clientFactory({warehouse:null,year:row.source.year,timeoutMs:60000})});
        }catch(e){error=e.message;blocked=e.status===403 || /sostituito|Emissione rifiutata/.test(e.message);}
        const outcome=checked(await db.rpc('warehouse_completion_result',{p_id:job.preparation_id,p_token:job.lease_token,p_done:!error,p_error:error,p_blocked:blocked}));
        results.push({id:job.preparation_id,status:outcome.status});
      }
      return res.status(200).json({results});
    }catch(error){return res.status(500).json({error:error.message});}
  };
}
export default createCompletionWorker();

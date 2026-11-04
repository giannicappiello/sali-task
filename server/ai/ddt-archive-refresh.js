import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {PDFDocument} from 'pdf-lib';
import {checked} from '../order-preparation-auth.js';
import {buildMexalClient} from '../mexal/sync-products.js';
import {verifyDdt} from '../order-preparation-mexal.js';

const fail=(message,status=409)=>Object.assign(new Error(message),{status});
export const ddtArchiveRefreshSchema={type:'object',additionalProperties:false,required:['preparationIds','reason'],properties:{
  preparationIds:{type:'array',minItems:1,maxItems:50,uniqueItems:true,items:{type:'string',format:'uuid'}},
  reason:{type:'string',minLength:5,maxLength:500},
}};
async function authorize(auth) {
  if(auth.profile?.ruoli?.amministratore_workspace!==true)throw fail('Aggiornamento archivio riservato agli amministratori.',403);
  const allowed=checked(await auth.admin.rpc('workspace_screen_permission_for_user',{target_user_id:auth.profile.id,target_screen:'magazzino.allestisci_ordini',permission_code:'warehouse.fulfillment.write'}));
  if(allowed!==true)throw fail('Aggiornamento archivio DDT non autorizzato.',403);
}
const moduleOf=doc=>String(doc.snapshot?.pdfPrintModule??doc.snapshot?.dispatch?.pdfPrintModule??'');
export async function readArchivedDdtPdfs(auth,ids=null) {
  await authorize(auth);
  const db=auth.admin,documents=[];
  const registry=checked(await db.from('ai_action_registry').select('active').eq('code','DDT_ARCHIVED_PDF_REFRESH').maybeSingle());
  const ready=registry?.active===true;
  for(let offset=0;;offset+=100){
    let q=db.from('warehouse_current_preparation_documents').select('preparation_id,kind,sha256,snapshot').in('kind',['bcf','bcf_print']).order('preparation_id').order('kind').range(offset,offset+99);
    if(ids)q=q.in('preparation_id',ids);
    const page=checked(await q);documents.push(...page);
    if(page.length<100)break;
    if(offset>=10000)throw fail('Archivio troppo esteso: selezionare gli allestimenti.');
  }
  const grouped=new Map();for(const doc of documents){if(!grouped.has(doc.preparation_id))grouped.set(doc.preparation_id,{});grouped.get(doc.preparation_id)[doc.kind]=doc;}
  const candidates=[...grouped].filter(([,docs])=>moduleOf(docs.bcf||{})!=='1'||moduleOf(docs.bcf_print||{})!=='1');
  if(!candidates.length)return {targets:[],ready,printModule:'1',readAt:new Date().toISOString()};
  const targetIds=candidates.map(([id])=>id);
  const rows=checked(await db.from('warehouse_order_preparations').select('id,status,source,ddt').in('id',targetIds));
  const jobs=checked(await db.from('warehouse_print_jobs').select('preparation_id,status').in('preparation_id',targetIds).eq('document_kind','bcf_print').in('status',['queued','leased','printing','uncertain']));
  const emails=checked(await db.from('warehouse_shipment_emails').select('preparation_id,status').in('preparation_id',targetIds).in('status',['queued','leased','sending','retry','uncertain']));
  const targets=rows.filter(row=>row.status==='completed'&&row.ddt?.signature==='BCF').map(row=>{
    const docs=grouped.get(row.id);
    return {id:row.id,year:row.source.year,order:`${row.source.series}/${row.source.number}`,document:`${row.ddt.series}/${row.ddt.number}`,reference:row.ddt.reference,
      expectedSha:docs.bcf?.sha256,expectedPrintSha:docs.bcf_print?.sha256,beforeModule:moduleOf(docs.bcf||{}),afterModule:'1',
      blocked:!docs.bcf||!docs.bcf_print?'Documenti archiviati incompleti.':jobs.some(job=>job.preparation_id===row.id)?'Stampa precedente in corso o con esito incerto.':emails.some(email=>email.preparation_id===row.id)?'Invio email precedente in corso o con esito incerto.':null};
  });
  return {targets,ready,printModule:'1',readAt:new Date().toISOString(),scope:'Nuove revisioni PDF BC1 e tre copie. Originali conservati; nessuna emissione, email o stampa.'};
}
export async function previewArchivedDdtRefresh(auth,input) {
  const evidence=await readArchivedDdtPdfs(auth,input.preparationIds);
  if(!evidence.ready)throw fail('Procedura archivio BC1 non ancora attivata nel database.');
  if(evidence.targets.length!==input.preparationIds.length)throw fail('Archivio cambiato o documenti già in BC1: rileggere gli allestimenti.');
  if(evidence.targets.some(target=>target.blocked))throw fail('Risolvere le stampe in corso o i documenti incompleti prima di confermare.');
  return {preparationIds:input.preparationIds,reason:input.reason,targetCode:'magazzino.allestisci_ordini',printModule:'1',targets:evidence.targets,scope:evidence.scope};
}
export async function renderArchivedDdtFiles(client,row) {
  if(Number(client.anno)!==row.source.year)throw fail('Anno Mexal diverso dalla bolla.');
  const actual=await client.getJson('/documenti/movimenti-magazzino/'+encodeURIComponent(row.ddt.reference));
  verifyDdt(actual,row,row.export_payload);
  const response=await client.printMovementPdf({sigla:'BC',serie:Number(row.ddt.series),numero:Number(row.ddt.number),cod_conto:row.source.customerCode,cod_modulo:'F'});
  const bytes=Buffer.from(response.body);
  if(bytes.length>10*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')throw fail('PDF BC1 non valido.');
  const source=await PDFDocument.load(bytes),print=await PDFDocument.create();
  if(!source.getPageCount())throw fail('PDF BC1 privo di pagine.');
  for(let copy=0;copy<3;copy++)for(const page of await print.copyPages(source,source.getPageIndices()))print.addPage(page);
  return [{kind:'bcf',filename:`DDT_${row.source.year}_${row.ddt.series}_${row.ddt.number}_BC1.pdf`,bytes},
    {kind:'bcf_print',filename:`DDT_${row.ddt.number}_BC1_3_copie.pdf`,bytes:Buffer.from(await print.save())}]
    .map(({bytes,...file})=>({...file,base64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')}));
}
export async function applyArchivedDdtRefresh(auth,pending,{clientFactory=buildMexalClient,render=renderArchivedDdtFiles}={}) {
  await authorize(auth);
  const db=auth.admin,actor=auth.profile.id;
  const saved=checked(await db.from('ai_action_audit').select('*').eq('id',pending.id).eq('user_id',actor).single());
  if(saved.status==='executed')return {action:saved,failure:null};
  if(saved.status!=='confirmed'||!saved.confirmed_at)throw fail('Conferma umana Workspace richiesta.',403);
  let failure=null;
  try {
    for(const target of saved.payload_summary.targets){
      const progress=checked(await db.from('ai_action_audit').select('result').eq('id',saved.id).single());
      if(progress.result?.updated?.some(item=>item.id===target.id))continue;
      const row=checked(await db.from('warehouse_order_preparations').select('*').eq('id',target.id).single());
      if(row.status!=='completed'||row.ddt?.reference!==target.reference||row.source.year!==target.year)throw fail('Bolla cambiata dopo la proposta.');
      const files=await render(clientFactory({warehouse:null,year:row.source.year,timeoutMs:60000}),row);
      // The RPC checks the persisted human decision, both hashes and active print jobs atomically.
      checked(await db.rpc('warehouse_refresh_ddt_pdf',{p_proposal:saved.id,p_actor:actor,p_id:row.id,p_files:files}));
    }
  }catch(error){failure=error.message;}
  const progress=checked(await db.from('ai_action_audit').select('*').eq('id',saved.id).eq('user_id',actor).single());
  if(progress.status==='executed')return {action:progress,failure:null};
  const result={...progress.result,printModule:'1',reemitted:false,emailsSent:false,printed:false};
  const action=checked(await db.rpc('complete_workspace_external_ai_action',{p_proposal_id:saved.id,p_succeeded:!failure,p_result:result,p_error:failure}));
  return {action:Array.isArray(action)?action[0]:action,failure};
}

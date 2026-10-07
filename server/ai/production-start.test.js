import test from 'node:test';
import assert from 'node:assert/strict';
import { productionStartPreview, executeProductionStart, productionStartStatus } from './production-start.js';
const phaseId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',hash='a'.repeat(64);
const input={targetId:100,kind:'production',phaseId,expectedHash:hash};
function fixture() {
 const action={id:'action',tool:'MES_PRODUCTION_START',status:'confirmed',payload_summary:input,request_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',result:null};
 let phase={id:phaseId,number:1,executionStatus:'NOT_STARTED',resource:'ST01',quantity:10,unit:'KG',lotCode:'TEST'};
 let printCount=0,authorizationCount=0;
 const job={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',printer:'PRODUZIONE',status:'Queued',sheet:{orderId:100,phaseId,startAfterPrint:true}};
 const chain={select(){return this;},eq(){return this;},update(patch){Object.assign(action,patch);return this;},
  async single(){return {data:action};},async maybeSingle(){return {data:action};}};
 const auth={profile:{id:'operator'},scoped:{from:()=>chain},admin:{from:()=>chain,rpc:async(name,args)=>{
  assert.equal(name,'complete_workspace_external_ai_action');action.status=args.p_succeeded?'executed':'failed';action.result=args.p_result;action.error=args.p_error;
  return {data:action};
 }}};
 const client={batchSheet:async payload=>{
   if(payload.operation==='list') return {result:{managed:true,phases:[phase]}};
   if(payload.operation==='sheet') return {result:{contentHash:hash,pdfBase64:'excluded',sheetHtml:'excluded',messages:['Materiale mancante']}};
   if(payload.operation==='print') {printCount++;assert.equal(payload.startAfterPrint,true);assert.equal(payload.externalId,action.request_id);return {result:{printJob:job}};}
   assert.fail('Unexpected request '+payload.operation);
 }};
 const dependencies={client,authorize:async()=>{authorizationCount++;},readJob:async()=>job};
 return {auth,action,job,dependencies,setPhase:value=>{phase={...phase,...value};},get prints(){return printCount;},get authorizations(){return authorizationCount;}};
}
test('preview identifies the requested batch and excludes PDF/HTML payloads',async()=>{
 const f=fixture(); const preview=await productionStartPreview(f.auth,input,f.dependencies);
 assert.equal(preview.phaseId,phaseId);assert.equal(preview.expectedHash,hash);assert.equal(preview.pdfBase64,undefined);
});
test('printing queues once; completion alone does not declare the production started',async()=>{
 const f=fixture();await executeProductionStart(f.auth,f.action,f.dependencies);
 assert.equal(f.prints,1);assert.equal(f.action.status,'confirmed');assert.equal(f.action.result.applied,false);
 f.job.status='Completed';
 assert.equal((await productionStartStatus(f.auth,'action',f.dependencies)).pending,true);
 f.job.confirmedAt='2026-10-07T08:00:00Z';
 assert.equal((await productionStartStatus(f.auth,'action',f.dependencies)).pending,true);
 f.setPhase({executionStatus:'RUNNING',actualStart:'2026-10-07T10:00:00'});
 const result=await productionStartStatus(f.auth,'action',f.dependencies);
 assert.equal(result.controlledAction.state,'executed');assert.equal(result.controlledAction.result.verified,true);
 assert.equal(result.answer,'Produzione avviata: in lavorazione.');assert.equal(f.prints,1);
 await productionStartStatus(f.auth,'action',f.dependencies);assert.equal(f.prints,1);
});
test('real start rejection after successful printing is returned, with no repeated print or start',async()=>{
 const f=fixture();await executeProductionStart(f.auth,f.action,f.dependencies);
 f.job.status='Completed';f.job.confirmationError='Lotto non disponibile.';
 const result=await productionStartStatus(f.auth,'action',f.dependencies);
 assert.equal(result.controlledAction.state,'failed');assert.match(result.answer,/Lotto non disponibile/);assert.equal(f.prints,1);
});
test('changed sheet or wrong batch never reaches the printer',async()=>{
 const f=fixture();await assert.rejects(productionStartPreview(f.auth,{...input,expectedHash:'b'.repeat(64)},f.dependencies),/foglio è cambiato/);
 await assert.rejects(productionStartPreview(f.auth,{...input,phaseId:'other'},f.dependencies),/non appartenente/);assert.equal(f.prints,0);
});
test('material shortage is forwarded only as explicit input; unavailable print endpoints cannot look successful',async()=>{
 const f=fixture();let shortage;
 const old=f.dependencies.client.batchSheet;
 f.dependencies.client.batchSheet=async payload=>{if(payload.operation==='print') shortage=payload.allowShortage;return old(payload);};
 f.action.payload_summary={...input,allowShortage:true};
 await executeProductionStart(f.auth,f.action,f.dependencies);assert.equal(shortage,true);assert.equal(f.action.status,'confirmed');
});
test('completed batch still verifies an earlier successful start',async()=>{
 const f=fixture();await executeProductionStart(f.auth,f.action,f.dependencies);
 f.job.status='Completed';f.job.confirmedAt='2026-10-07T08:00:00Z';
 f.setPhase({executionStatus:'COMPLETED',actualStart:'2026-10-07T10:00:00'});
 const result=await productionStartStatus(f.auth,'action',f.dependencies);
 assert.equal(result.controlledAction.state,'executed');assert.match(result.answer,/già conclusa/);
});


test('pre-print validation failure is definite and does not ask to check a nonexistent print',async()=>{
 const f=fixture();f.action.payload_summary={...input,expectedHash:'b'.repeat(64)};
 const result=await executeProductionStart(f.auth,f.action,f.dependencies);
 assert.equal(f.prints,0);assert.equal(result.action.status,'failed');
 assert.equal(result.action.result.uncertain,false);assert.doesNotMatch(result.failure,/coda stampa/);
});
test('replaying the status of a completed production keeps the truthful outcome',async()=>{
 const f=fixture();await executeProductionStart(f.auth,f.action,f.dependencies);
 f.job.status='Completed';f.job.confirmedAt='2026-10-07T08:00:00Z';
 f.setPhase({executionStatus:'COMPLETED',actualStart:'2026-10-07T10:00:00'});
 await productionStartStatus(f.auth,'action',f.dependencies);
 const replay=await productionStartStatus(f.auth,'action',f.dependencies);
 assert.match(replay.answer,/già conclusa/);assert.equal(f.prints,1);
});

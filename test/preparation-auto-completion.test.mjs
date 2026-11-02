import test from 'node:test';
import assert from 'node:assert/strict';
import {createdDdtReference,readEmittedDdt} from '../server/preparation-ddt-readback.js';
import {completePreparation,createCompletionWorker,completionAuthorized,completionWorkerToken} from '../server/preparation-auto-completion.js';
import {createOrderPreparationHandler} from '../server/order-preparation-handler.js';
import {preparationDatabase,supabaseAdapter,mexalFixture,actor,event} from './order-preparation-fixture.mjs';
const {PGlite}=await import(process.env.PGLITE_MODULE);

test('201 Location reads the created BCF directly and index delays only retry reads',async()=>{
  const payload={serie:1,cod_conto:'501.00001'};
  const creation={mexalHttpResponse:{headers:{Location:'/webapi/risorse/documenti/movimenti-magazzino/BC%2B1%2B2122%2B501.00001'}}};
  assert.equal(createdDdtReference(creation,payload),'BC+1+2122+501.00001');
  assert.throws(()=>createdDdtReference({mexalHttpResponse:{headers:{location:'/unrelated/BC+1+2'}}},payload));
  let reads=0,searches=0;const waits=[];
  const actual={numero:2122};
  const client={getJson:async path=>{reads++;assert.match(path,/BC%2B1%2B2122/);if(reads<3)throw Object.assign(Error('Index pending'),{status:404});return actual;}};
  assert.equal(await readEmittedDdt({client,creation,payload,findExisting:async()=>{throw Error('Search not needed');},wait:async n=>waits.push(n)}),actual);
  assert.deepEqual(waits,[1000,2500]);
  assert.equal(await readEmittedDdt({client:{},creation:{},payload,findExisting:async()=>++searches<3?null:actual,wait:async()=>{}}),actual);
  assert.equal(searches,3);
});

test('durable completion survives index delay, leases work, checks permissions and prints each pallet once',async()=>{
  const sql=await preparationDatabase(PGlite),base=supabaseAdapter(sql),mexal=mexalFixture();let row,allowed=true;
  const db={from:base.from,rpc:(name,args)=>name==='workspace_screen_permission_for_user'?Promise.resolve({data:allowed,error:null}):base.rpc(name,args)};
  const handler=createOrderPreparationHandler({authorize:async()=>({db,profile:{id:actor},canWrite:true,canConfigure:true}),clientFactory:()=>mexal});
  async function call(operation,input={}){const res={setHeader(){},status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;}};await handler({method:'POST',body:{operation,id:row?.id,version:row?.version,eventId:event(),...input}},res);assert.equal(res.statusCode,200,JSON.stringify(res.data));if(res.data.preparation)row=res.data.preparation;return res.data;}
  try {
    await call('begin',{reference:'OC+1+900'});await call('add_pallet',{palletId:event(),assignUnassigned:true});
    const pack=row.state.packages[0].id;
    await call('scan',{packageId:pack,barcode:'IT0001',mode:'carton'});
    await call('scan',{packageId:pack,barcode:'IT0002',mode:'piece'});await call('verify');
    const preview=await call('preview_dispatch');await call('export',{dispatchHash:preview.hash});
    assert.equal(mexal.sends,1);
    assert.equal((await call('completion_status')).completion.status,'queued');
    assert.equal((await db.rpc('warehouse_completion_claim',{})).data,null);
    await sql.exec("update warehouse_completion_jobs set next_attempt_at=now()-interval '1 second'");
    const claim=(await db.rpc('warehouse_completion_claim',{})).data;
    assert.ok(claim.lease_token);assert.equal((await db.rpc('warehouse_completion_claim',{})).data,null);
    assert.ok((await db.rpc('warehouse_completion_result',{p_id:row.id,p_token:event(),p_done:true,p_error:null,p_blocked:false})).error);
    const retry=await db.rpc('warehouse_completion_result',{p_id:row.id,p_token:claim.lease_token,p_done:false,p_error:'Index delayed',p_blocked:false});
    assert.equal(retry.data.status,'queued');assert.ok(Date.parse(retry.data.next_attempt_at)>Date.now());
    await sql.exec("insert into warehouse_printers(id,station,name) values('MES:Laser','MES','Laser');update warehouse_preparation_settings set ddt_printer_id='MES:Laser',packing_printer_id='MES:Laser'");
    await sql.exec("update warehouse_order_preparations set status='uncertain',ddt=null,error='Index delayed'");
    const persisted=(await sql.query('select * from warehouse_order_preparations where id=$1',[row.id])).rows[0];
    let inventories=0,syncs=0;
    const printing={inventory:async()=>{inventories++;},sync:async(db,id)=>{syncs++;return (await sql.query("update warehouse_print_jobs set status='submitted' where id=$1 returning *",[id])).rows[0];}};
    const completed=await completePreparation({db,row:persisted,client:mexal,printing});
    assert.equal(completed.status,'completed');
    await completePreparation({db,row:completed,client:mexal,printing});
    const jobs=(await sql.query('select document_kind,copies from warehouse_print_jobs')).rows;
    assert.equal(jobs.length,2);assert.equal(syncs,2);assert.equal(inventories,2);
    assert.equal(jobs.find(j=>j.document_kind==='bcf_print').copies,3);
    assert.equal(jobs.find(j=>j.document_kind.startsWith('packing_pallet_')).copies,1);
    assert.equal(mexal.sends,1);
    allowed=false;await assert.rejects(completePreparation({db,row:persisted,client:mexal,printing}),/revocato/);
    assert.equal(syncs,2);
    await sql.exec("update warehouse_completion_jobs set next_attempt_at=now()-interval '1 second'");
    const worker=createCompletionWorker({adminFactory:()=>db,clientFactory:()=>mexal,authorize:()=>true,complete:async()=>{}});
    const res={setHeader(){},status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;}};
    await worker({method:'POST'},res);assert.equal(res.data.results[0].status,'completed');
    assert.equal(mexal.sends,1);
    await assert.rejects(sql.exec('delete from warehouse_preparation_events'),/immutabile/);
  } finally {await sql.close();}
});

test('completion endpoint rejects unauthenticated callers before touching the database',async()=>{
  assert.equal(completionAuthorized({headers:{authorization:'Bearer '+completionWorkerToken('test')}},'test'),true);
  assert.equal(completionAuthorized({headers:{authorization:'Bearer '+completionWorkerToken('other')}},'test'),false);
  const worker=createCompletionWorker({adminFactory:()=>{throw Error('Forbidden DB access');},authorize:()=>false});
  const res={setHeader(){},status(n){this.statusCode=n;return this;},json(){return this;}};
  await worker({method:'POST',headers:{}},res);assert.equal(res.statusCode,401);
});

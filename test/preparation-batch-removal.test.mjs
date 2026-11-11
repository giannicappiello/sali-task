import {preparationAuditRecord} from '../shared/preparationAudit.js';
/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {appendPreparationScan} from '../shared/preparationScanning.js';
import {preparationDatabase,supabaseAdapter,mexalFixture,actor,event} from './order-preparation-fixture.mjs';
import {createOrderPreparationHandler} from '../server/order-preparation-handler.js';
const product={code:'IT0001',scannedValue:'IT0001',piecesPerCarton:3,boxesPerPallet:4};
function empty(){const palletId=event(),packageId=event();return {pallets:[{id:palletId,number:1}],packages:[{id:packageId,palletId,number:1}],scans:[],confirmedLots:false};}
for(const [mode,pieces,boxes,pallets] of [['piece',2,1,1],['carton',6,2,1],['pallet',24,8,2]]){
 test(`quantity 2 ${mode}: exact pieces and physical containers`,()=>{
  const state=empty(),id=event(),body={mode,units:2,palletId:state.pallets[0].id,packageId:state.packages[0].id};
  const result=appendPreparationScan(state,product,body,id,actor,randomUUID,'2026-11-11T12:00:00Z');
  assert.equal(result.scans.reduce((n,s)=>n+s.quantity,0),pieces);assert.equal(result.packages.length,boxes);assert.equal(result.pallets.length,pallets);
  assert.ok(result.scans.every(s=>s.operationId===id));assert.equal(state.scans.length,0);
  if(mode==='pallet') for(const p of result.pallets)assert.equal(result.packages.filter(b=>b.palletId===p.id).length,4);
 });
}
test('batch rejects zero, negative, fractional, empty and oversized quantities atomically',()=>{
 for(const units of [0,-1,1.5,'',10001,'abc']){const state=empty();assert.throws(()=>appendPreparationScan(state,product,{mode:'carton',units,packageId:state.packages[0].id},event(),actor,randomUUID,''),/Quantità/);assert.equal(state.scans.length,0);}
 const state=empty();assert.throws(()=>appendPreparationScan(state,product,{mode:'pallet',units:201,palletId:state.pallets[0].id,packageId:state.packages[0].id},event(),actor,randomUUID,''),/estesa/);
});
test('API batches replay once and deletions preserve other pallets with an audit trail',{skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE),sql=await preparationDatabase(PGlite),db=supabaseAdapter(sql),mexal=mexalFixture();let row,writable=true;
 const handler=createOrderPreparationHandler({authorize:async()=>({db,profile:{id:actor},canWrite:writable,canConfigure:false}),clientFactory:()=>mexal});
 async function call(operation,input={}){const res={setHeader(){},status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;}};await handler({method:'POST',body:{operation,id:row?.id,version:row?.version,eventId:event(),...input}},res);if(res.data.preparation)row=res.data.preparation;return res;}
 async function ok(op,input){const r=await call(op,input);assert.equal(r.statusCode,200,JSON.stringify(r.data));return r.data;}
 try{
  await ok('begin',{reference:'OC+1+900'});const palletId=event();await ok('add_pallet',{palletId,assignUnassigned:true});
  const request={eventId:event(),barcode:'IT0001',mode:'pallet',units:2,packageId:row.state.packages[0].id,palletId,piecesPerCarton:2,boxesPerPallet:3};
  const result=await ok('scan',request);assert.equal(result.scan.quantity,12);assert.equal(row.state.pallets.length,2);assert.equal(row.state.packages.length,6);
  await ok('scan',request);assert.equal(row.state.scans.length,6,'same event adds nothing twice');
  let r=await call('remove_pallet',{palletId});assert.equal(r.statusCode,400);assert.equal(row.state.scans.length,6);
  writable=false;r=await call('remove_pallet',{palletId,confirmed:true,reason:'Correzione'});assert.equal(r.statusCode,403);writable=true;
  await ok('remove_pallet',{palletId,confirmed:true,reason:'Bancale inserito per errore'});assert.equal(row.state.pallets.length,1);assert.equal(row.state.packages.length,3);assert.equal(row.state.scans.length,3);
  const scanId=row.state.scans[0].id;
  r=await call('remove_scan',{scanId,reason:'Errore'});assert.equal(r.statusCode,400);
  await ok('remove_scan',{scanId,confirmed:true,reason:'Lettura duplicata'});assert.equal(row.state.scans.length,2);assert.equal(row.state.packages.length,3);
  const audit=(await ok('audit')).events.map(preparationAuditRecord);assert.ok(audit.some(item=>item.operation==='remove_pallet' && item.readings.filter(s=>s.action==='remove').length===3));assert.ok(audit.some(item=>item.operation==='remove_scan' && item.readings.some(s=>s.action==='remove')));
  assert.equal(mexal.sends,0,'editing never sends a DDT');
 }finally{await sql.close();}
});

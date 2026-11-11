import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeControlSource,readMesControlSource} from './sources.js';

const now=new Date('2026-11-11T06:00:00Z');
const task=(id,previousTaskId=null)=>({id,orderId:id,type:0,status:0,resourceId:id,start:'2026-11-12T08:00:00',end:'2026-11-12T09:00:00',previousTaskId});
const demand=(id,quantity=1,requiredAt='2026-11-12T08:00:00')=>({productionOrderId:id,articleId:10,articleCode:'MP1',quantity,unitOfMeasure:'KG',requiredAt,priority:0});
const source=()=>({contractVersion:1,readOnly:true,source:'ProgreMES.APS',generatedAtUtc:now.toISOString(),planning:{version:{snapshot:{tasks:[task(1)]}}},purchasing:{contractVersion:4,demands:[demand(1)],stocks:[{articleId:10,availableQuantity:10}],arrivals:[],warnings:[]},planningState:{releaseShortages:[]},inventory:[],supplierLines:[],reservations:[],resources:[],quality:[],sync:[]});

test('MES contract v4 stock consumes evaluated unplanned reservations only once',()=>{
 const s=source();
 s.purchasing.demands=[demand(2,4,'2026-11-11T08:00:00'),demand(1,5)];
 s.reservations=[{orderId:2,articleId:10,quantity:4}];
 const result=analyzeControlSource(s,{now});
 assert.equal(result.findings.filter(f=>f.category==='material_shortage').length,0);
});

test('cascades reach every downstream order regardless of task order and stop on cycles',()=>{
 const s=source();s.planning.version.snapshot.tasks=[task(1,2),task(2,3),task(3,1)];
 s.purchasing.demands=[demand(1),demand(2),demand(3)];
 s.quality=[{id:30,orderId:3,conformity:'NonConforme'}];
 const result=analyzeControlSource(s,{now});
 assert.deepEqual(result.findings.filter(f=>f.category==='cascade').map(f=>f.evidence.jobId).sort(),[1,2]);
});

test('uninterpretable movements keep receipt coverage incomplete',()=>{
 const result=analyzeControlSource(source(),{now,mexal:{movements:[{}],movementGap:null,progressives:[],readAt:now.toISOString()}});
 assert.equal(result.coverage.movements.complete,false);
 assert.equal(result.coverage.receipts.complete,false);
 assert(result.gaps.some(g=>g.source==='receipts'));
});

test('MES source reader rejects obsolete endpoints and incomplete contracts',async()=>{
 const env={PROGREMES_URL:'https://mes.example.test',PROGREMES_INTEGRATION_SECRET:'fixture'};
 await assert.rejects(readMesControlSource({env,fetchImpl:async()=>new Response('',{status:404})}),{status:409});
 await assert.rejects(readMesControlSource({env,fetchImpl:async()=>Response.json({...source(),purchasing:{contractVersion:3}})}),/Contratto/);
 const s=source();assert.deepEqual(await readMesControlSource({env,fetchImpl:async()=>Response.json(s)}),s);
});

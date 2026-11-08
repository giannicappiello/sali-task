import test from 'node:test';
import assert from 'node:assert/strict';
import { financeCatalog, checkedFinancePath, mexalFinanceTools, financePage } from './mexal-finance.js';
import { mexalArchiveTools } from './mexal-archive.js';
import { memorySnapshot, sourceMemoryTools } from './source-memory.js';
import { objectSchema } from './schema.js';

const admin={profile:{id:'admin',ruoli:{amministratore_workspace:true}},capabilities:{internal_data:true},scoped:{rpc:async name=>({data:name==='workspace_user_is_admin'?true:{mode:'tutti'}})}};
const help={resources:[{method:'GET',regexp:'/scadenzario',descrizione:'Scadenzario'},{method:'POST',regexp:'/scadenzario'},{method:'GET',regexp:'/contabilita/saldi'},{method:'GET',regexp:'/contabilita/password'},{method:'GET',regexp:'/utenti'},{method:'DELETE',regexp:'/documenti/movimenti-magazzino/.*'}]};
test('finance discovers only advertised financial GETs and rejects arbitrary, encoded or mutated paths',()=>{
 const entries=financeCatalog(help);assert.equal(entries.length,2);
 const cap=entries.find(x=>x.pattern==='/scadenzario');assert.equal(checkedFinancePath('/scadenzario',cap),'/scadenzario');
 for(const path of ['/utenti','/scadenzario?x=1','//evil.test','/../scadenzario','/%2e%2e/scadenzario','/scadenzario#x','https://evil.test'])assert.throws(()=>checkedFinancePath(path,cap));
});
test('admin and global scope are verified before any Mexal connection, including revocation/errors',async()=>{
 assert.deepEqual(mexalFinanceTools({...admin,capabilities:{internal_data:false}}),{});
 assert.deepEqual(mexalArchiveTools({...admin,capabilities:{internal_data:false}}),{});
 for(const scenario of ['user','revoked','scope','offline']) {
  const a={...admin,profile:scenario==='user'?{ruoli:{}}:admin.profile,scoped:{rpc:async name=>scenario==='offline'?{error:Error('unavailable')}:{data:name==='workspace_user_is_admin'?scenario!=='revoked':{mode:'team'}}}};
  if(scenario==='user'){assert.deepEqual(mexalFinanceTools(a),{});continue;}
  const tools=mexalFinanceTools(a,{clientForYear:()=>{assert.fail('must not connect');}});
  await assert.rejects(tools.MEXAL_FINANCE_CATALOG.execute({}));
 }
});
test('admin finance uses the existing admin entitlement, not an impossible integration AI module',async()=>{
 // Actual workspace_ai_capabilities SQL never includes integrazioni, even
 // for admins. Missing it is not a denied admin operation.
 const actual={...admin,capabilities:{internal_data:true,allowed_modules:['prodotti','ordini_pr','progremes']}};
 const t=mexalFinanceTools(actual,{clientForYear:()=>({getJson:async()=>help})});
 assert(t.MEXAL_FINANCE_CATALOG);assert(mexalArchiveTools(actual).MEXAL_ARCHIVE_READ);
 const result=await t.MEXAL_FINANCE_CATALOG.execute({});assert.equal(result.capabilities.length,2);
});
test('finance reuses the connection, rechecks live contract, paginates, and preserves official values',async()=>{
 const calls=[],payload={items:[{amount:'123.4567',currency:'EUR',date:'2026-11-08'}],next:'opaque+cursor'};
 const tools=mexalFinanceTools(admin,{clientForYear:year=>({azienda:'TEST',anno:year,getJson:async path=>{calls.push(path);return path==='/help'?help:payload;}})});
 const cat=await tools.MEXAL_FINANCE_CATALOG.execute({year:2026});
 const id=cat.capabilities.find(x=>x.pattern==='/scadenzario').id;
 const result=await tools.MEXAL_FINANCE_READ.execute({year:2026,capabilityId:id,path:'/scadenzario',tipo:'P',max:10,next:'opaque+cursor'});
 assert.deepEqual(result.payload,payload);assert.equal(result.payload.items[0].amount,'123.4567');
 assert(calls.at(-1).includes('next=opaque%2Bcursor'));assert(calls.at(-1).includes('tipo=P'));assert.equal(calls.filter(p=>p==='/help').length,2);
 await assert.rejects(tools.MEXAL_FINANCE_READ.execute({capabilityId:'0'.repeat(64),path:'/scadenzario'}),{status:403});
 const blocked=mexalFinanceTools(admin,{clientForYear:()=>({getJson:async path=>path==='/help'?help:{password:'never-return'}})});
 await assert.rejects(blocked.MEXAL_FINANCE_READ.execute({capabilityId:id,path:'/scadenzario'}),{status:422});
});
test('connector bounds responses when Mexal ignores max, preserving every official row and upstream cursor',()=>{
 const payload={dati:Array.from({length:207},(_,id)=>({id,amount:'12.3456'})),data_ric_elab:'now',next:'vendor-cursor'};
 const before=JSON.stringify(payload),ids=[];let offset=0,snapshot;
 do {
  const p=financePage(payload,{max:50,offset,snapshot});
  snapshot=p.pagination.snapshot;assert(p.payload.dati.length<=50);assert.equal(p.pagination.sourcePageRows,207);assert.equal(p.pagination.upstreamNext,'vendor-cursor');
  ids.push(...p.payload.dati.map(r=>r.id));offset=p.pagination.nextOffset;
 }while(offset!==null);
 assert.equal(ids.length,207);assert.equal(new Set(ids).size,207);assert.equal(JSON.stringify(payload),before);
 assert.throws(()=>financePage({...payload,dati:payload.dati.slice(1)},{max:50,offset:50,snapshot}),{status:409});
 assert.equal(financePage({balance:'12.3456'}).pagination,null);
 const a=memorySnapshot('MEXAL_FINANCE_READ',{},financePage(payload,{max:1}));
 const b=memorySnapshot('MEXAL_FINANCE_READ',{},financePage({...payload,data_ric_elab:'later'},{max:1}));
 assert.equal(a.snapshot,b.snapshot);
});
test('financial discovery includes accounts and routes described as accounting data',()=>{
 assert.equal(financeCatalog([{method:'GET',regexp:'^/conti/{0,1}$'},{method:'GET',regexp:'^/pdc/{0,1}$',descrizione:'piano dei conti'}]).length,2);
});
test('complete archive reads retain personal RLS and fixed fields without recalculating amounts',async()=>{
 const calls=[];const q={then(resolve){return Promise.resolve({data:[{id:'a',totale_imponibile:'12.3456'},{id:'b'},{id:'c'}]}).then(resolve);}};
 for(const method of ['select','eq','gte','lte','order','range'])q[method]=(...args)=>{calls.push([method,...args]);return q;};
 const auth={...admin,admin:{from(){assert.fail('RLS bypass');}},scoped:{...admin.scoped,from:table=>{assert.equal(table,'mexal_fatture_vendita');return q;}}};
 const tool=mexalArchiveTools(auth).MEXAL_ARCHIVE_READ;
 const p=await tool.execute({dataset:'invoices',limit:2,from:'2026-01-01'});
 assert.equal(p.rows.length,2);assert.equal(p.nextOffset,2);assert.equal(p.rows[0].totale_imponibile,'12.3456');assert.deepEqual(calls.find(c=>c[0]==='range'),['range',0,2]);
 assert(!calls.find(c=>c[0]==='select')[1].includes('*'));
 await assert.rejects(tool.execute({dataset:'invoice_lines'}),/documentId/);
 await assert.rejects(tool.execute({dataset:'warehouse_history',from:'2026-02-30'}));
});
test('memory previews are timestamp-stable, versioned, personal and never import credentials',()=>{
 const a=memorySnapshot('MES_READ',{resource:'articles'},{readAt:'a',items:[{id:1,value:0}]},'2026-11-08T09:00:00Z');
 const b=memorySnapshot('MES_READ',{resource:'articles'},{readAt:'b',items:[{id:1,value:0}]},'2026-11-08T09:01:00Z');
 assert.equal(a.snapshot,b.snapshot);assert.equal(a.entries[0].sourceKey,b.entries[0].sourceKey);assert.equal(a.entries[0].scope,'personal');assert(a.entries[0].content.includes('"value":0'));
 const changed=memorySnapshot('MES_READ',{resource:'articles'},{items:[{id:1,value:1}]});assert.notEqual(changed.entries[0].sourceKey,a.entries[0].sourceKey);
 assert.throws(()=>memorySnapshot('MES_READ',{}, {access_token:'secret'}));
 const clean=memorySnapshot('MES_READ',{}, {note:'Bearer abcdefghijklmnopqrstuvwxyz'});assert.equal(clean.redacted,true);assert(!clean.entries[0].content.includes('abcdefghijklmnopqrstuvwxyz'));
});
test('source memory cannot execute writes, rechecks source and requires human review without saving',async()=>{
 let reads=0,writes=0,amount=1;
 const tools={MES_READ:{effect:'read',inputSchema:objectSchema(),execute:async()=>{reads++;return {amount};}},MUTATE:{effect:'propose',inputSchema:objectSchema(),execute:()=>assert.fail('write')}};
 const a={...admin,scoped:{rpc:async(name,args)=>{writes++;assert.equal(name,'second_brain_propose');assert.equal(args.p_tool,'MEMORY_SAVE');assert.equal(args.p_input.scope,'personal');return {data:{id:'proposal',status:'proposed'}};}}};
 const memory=sourceMemoryTools(a,tools),input={tool:'MES_READ',arguments:{}};
 const preview=await memory.BRAIN_SOURCE_MEMORY_PREVIEW.execute(input);assert.equal(reads,1);assert.equal(writes,0);
 amount=2;await assert.rejects(memory.BRAIN_SOURCE_MEMORY_PROPOSE.execute({...input,expectedSnapshot:preview.snapshot}),{status:409});assert.equal(writes,0);
 amount=1;const proposed=await memory.BRAIN_SOURCE_MEMORY_PROPOSE.execute({...input,expectedSnapshot:preview.snapshot});assert.equal(proposed.saved,false);assert.equal(proposed.requiresHuman,true);assert.deepEqual(proposed.proposals[0],{id:'proposal',kind:'brain',status:'proposed',sourceKey:preview.entries[0].sourceKey});
 await assert.rejects(memory.BRAIN_SOURCE_MEMORY_PREVIEW.execute({tool:'MUTATE',arguments:{}}),{status:403});
});

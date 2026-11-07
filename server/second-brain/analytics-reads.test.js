import { preparationSession } from '../order-preparation-auth.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { productionReportTools, reportPage } from './production-report-reads.js';
import { logisticsReadTools } from './logistics-reads.js';
import { createBrainCatalog } from './catalog.js';
import { validateInput } from './schema.js';
import { calculateRecord, defaultSettings } from '../../src/features/production-costs/cost-engine.js';
import { displayRecord } from '../../src/features/production-costs/cost-display.js';
import { preparationAuditPage } from '../../shared/preparationAudit.js';
import { handleProductionCosts } from '../production-costs.js';
import { readStationHistory } from '../production-station-history.js';
import { readFillingHistory } from '../production-filling-history.js';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const auth={scoped:{rpc:async()=>({data:{mode:'tutti'}})},token:'test-only',profile:{ruoli:{}},access:{modules:['progremes','allestisci_ordini']},capabilities:{internal_data:true,progremes:true,allowed_modules:['progremes','allestisci_ordini']}};
function record(n,extra={}) {
 const e={id:n,orderNumber:'OP/'+n,customerCode:'C1',customerName:'Cliente test',articleCode:'A',unit:'KG',quantity:100,state:'Terminato',date:'2026-09-07',works:[{id:n,machineId:1,phase:'Semilavorato',state:'Terminato',goodQuantity:100,start:'2026-09-07T09:00:00',end:'2026-09-07T16:00:00',personnel:[]}],...extra};
 return calculateRecord(e,{settings:{...defaultSettings(),laborHourly:20,mixingOperatorsCount:3,machines:[{id:1,code:'ST1',washCost:0,gainPerWork:500}]}}, {},{octRevenue:1000,invoiceRevenue:n%2?500:null,invoicedQuantity:n%2?50:null});
}
function database(tables={},rpc=()=>({data:null})) {
 const log=[];
 return {log,rpc:async(name,args)=>{log.push(['rpc',name]);return rpc(name,args);},from(table){
  let rows=structuredClone(tables[table]||[]),single=false;
  const q={select(){return q;},order(k,o){rows.sort((a,b)=>(a[k]<b[k]?-1:a[k]>b[k]?1:0)*(o?.ascending===false?-1:1));return q;},eq(k,v){rows=rows.filter(r=>r[k]===v);return q;},in(k,v){rows=rows.filter(r=>v.includes(r[k]));return q;},gt(k,v){rows=rows.filter(r=>r[k]>v);return q;},lte(k,v){rows=rows.filter(r=>r[k]<=v);return q;},not(){rows=rows.filter(r=>r.payload?.state);return q;},limit(n){rows=rows.slice(0,n);return q;},range(a,b){rows=rows.slice(a,b+1);return q;},maybeSingle(){single=true;return q;},single(){single=true;return q;},then(ok,no){log.push(['select',table]);return Promise.resolve({data:single?(rows[0]??null):rows}).then(ok,no);}};
  for(const verb of ['insert','update','upsert','delete'])q[verb]=()=>{throw Error('FORBIDDEN WRITE '+verb+' '+table);};
  return q;
 }};
}
test('catalog exposes only read tools inside explicit module AI scope, including admin restrictions',()=>{
 for(const a of [auth,{...auth,profile:{ruoli:{amministratore_workspace:true}},capabilities:{...auth.capabilities,allowed_modules:[]}}]){
  const tools=createBrainCatalog(a),allowed=a===auth;
  for(const name of ['PRODUCTION_CONSUNTIVI_READ','LOGISTICS_PREPARATIONS_READ','LOGISTICS_PREPARATION_REGISTER_READ']){
   assert.equal(Boolean(tools[name]),allowed);if(allowed)assert.equal(tools[name].effect,'read');
  }
 }
 assert.deepEqual(productionReportTools({...auth,capabilities:{internal_data:false}}),{});
});
test('consuntivi service and report use identical calculations with no writes and customer scoping',async()=>{
 const calendar={versions:[{effectiveFrom:'2026-01-01',week:Object.fromEntries([1,2,3,4,5,6,7].map(d=>[d,d<6?[['09:00','16:00']]:[]]))}],closures:[],exceptions:[]};
 const tables={production_cost_records:[{mes_order_id:1,evidence:record(1)},{mes_order_id:2,evidence:record(2,{customerCode:'OTHER'})}],production_cost_configurations:[]};
 const db=database(tables,n=>{assert.equal(n,'workspace_company_calendar_data');return {data:calendar};});
 const sessionFactory=async(_req,screen,write)=>{assert.equal(screen,'produzione.consuntivi');assert.equal(write,false);return {admin:db,caller:db,profile:{id:'test'},scope:{mode:'cliente',customer_codes:['C1']},canWrite:false};};
 const normal=await handleProductionCosts({}, {operation:'list'}, {sessionFactory});
 const pure=await handleProductionCosts({}, {operation:'list'}, {readOnly:true,sessionFactory});
 assert.deepEqual(pure,normal);assert.equal(pure.records.length,1);
 await assert.rejects(handleProductionCosts({}, {operation:'sync'}, {readOnly:true,sessionFactory}),{status:400});
 const actual=await productionReportTools(auth,{run:async()=>pure}).PRODUCTION_CONSUNTIVI_READ.execute({});
 assert.equal(actual.rows[0].actualWithObjective,displayRecord(normal.records[0]).actualWithObjective);
});
test('KPI parity, date/machine/invoice/search filters, Sali separation, nulls and complete pagination',()=>{
 const records=Array.from({length:107},(_,i)=>record(i+1));records.push(record(999,{customerCode:'501.00995'}));
 let offset=0,snapshot,ids=[];
 do{const p=reportPage(records,{offset,limit:20,snapshot});snapshot=p.snapshot;ids.push(...p.rows.map(r=>r.id));offset=p.nextOffset;}while(offset!==null);
 assert.equal(ids.length,108);assert.equal(new Set(ids).size,108);
 const p=reportPage(records,{});assert.equal(p.summary.ordinary.count,107);assert.equal(p.summary.sali.count,1);
 assert.equal(p.summary.ordinary.actual,records.slice(0,107).map(displayRecord).map(r=>r.actualWithObjective).filter(v=>v!=null).reduce((s,v)=>s+v,0));
 assert.equal(reportPage(records,{from:'2026-09-08'}).total,0);
 assert.equal(reportPage(records,{machine:2}).total,0);
 assert.equal(reportPage(records,{invoiceState:'available'}).total,55);
 assert.equal(reportPage(records,{query:'DOES-NOT-EXIST'}).total,0);
 assert.throws(()=>reportPage(records.slice(1),{snapshot}),{status:409});
 const empty=reportPage([],{});assert.equal(empty.summary.ordinary.actual,null);assert.equal(empty.nextOffset,null);
 for(const input of [{from:'2026-02-30'},{offset:-1},{limit:51},{invoiceState:'x'}])assert.throws(()=>reportPage(records,input));
 const schema=productionReportTools(auth).PRODUCTION_CONSUNTIVI_READ.inputSchema;
 assert.throws(()=>validateInput(schema,{operation:'sync'}));
});
test('specific screen denial is propagated on every invocation',async()=>{
 const denied=async()=>{throw Object.assign(Error('Denied'),{status:403});};
 await assert.rejects(productionReportTools(auth,{run:denied}).PRODUCTION_CONSUNTIVI_READ.execute({}),{status:403});
 await assert.rejects(logisticsReadTools(auth,{authorize:denied}).LOGISTICS_PREPARATIONS_READ.execute({}),{status:403});
});
test('historical departments compute same source without persisting snapshots',async()=>{
 const source={generatedAt:'2026-09-11T15:00:00Z',asOfLocal:'2026-09-11T17:00:00',completedWorks:1,calendarShifts:1,completedPieces:100,cartoningPieces:0,mixingOperatorsCount:3,packagingOperatorsCount:5,works:[],calendar:{shifts:defaultSettings().shifts}};
 const companyCalendar={versions:[{effectiveFrom:'2026-01-01',week:Object.fromEntries([1,2,3,4,5,6,7].map(d=>[d,d<6?[['09:00','16:00']]:[]]))}],exceptions:[],closures:[]};
 const db=database();
 for(const read of [readStationHistory,readFillingHistory]){
  const options={companyCalendar,historyFrom:'2026-09-07',request:async()=>[{...source,works:[{id:1,phase:read===readStationHistory?'Semilavorato':'Confezionamento',state:'Terminato',start:'2026-09-07T09:00:00',end:'2026-09-07T16:00:00',goodQuantity:100,unit:'PZ'}]}]};
  const result=await read(db,{...options,persist:false});
  let savedSource;
  const archive={from(){return {upsert:async row=>{savedSource=row.source;return {};},select(){return this;},eq(){return this;},single:async()=>({data:{id:'snapshot',created_at:'2026-09-11'}})};}};
  const persisted=await read(archive,options);
  const comparable={...persisted};delete comparable.snapshotId;delete comparable.snapshotCapturedAt;
  assert.deepEqual(result,comparable);assert(savedSource,JSON.stringify(result));
  assert.equal(result.error,null);assert.equal(result.snapshotId,undefined);assert.equal(result.generatedAt,source.generatedAt);
 }
 assert.equal(db.log.length,0);
});
test('logistics pagination and audit reconstruct corrections across pages without raw payload or addresses',async()=>{
 const state={scans:[{id:'s',code:'A',quantity:1,actor:id(90)}],packages:[],pallets:[]};
 const events=Array.from({length:102},(_,i)=>({id:i+1,preparation_id:id(1),event_id:id(i+1),event_type:'scan',actor:id(90),created_at:'2026-11-07T10:00:00Z',payload:{state:{...state,scans:[{...state.scans[0],quantity:i+1}]},recipients:['SECRET'],reason:'private'}}));
 const db=database({warehouse_order_preparations:Array.from({length:51},(_,i)=>({id:id(i+1),created_at:'2026-11-01T00:00:00Z',source:{reference:'OC/'+i,address:'SECRET'},state})),warehouse_preparation_events:events});
 const tools=logisticsReadTools(auth,{authorize:async()=>({db})});
 const a=await tools.LOGISTICS_PREPARATIONS_READ.execute({});assert.equal(a.rows.length,50);assert.equal(a.nextAfter,id(50));
 const b=await tools.LOGISTICS_PREPARATIONS_READ.execute({after:a.nextAfter,asOf:a.asOf});assert.equal(b.rows.length,1);assert.equal(b.nextAfter,null);
 const first=await tools.LOGISTICS_PREPARATION_REGISTER_READ.execute({id:id(1)});assert.equal(first.records.length,100);assert.equal(first.maxId,102);
 const second=await tools.LOGISTICS_PREPARATION_REGISTER_READ.execute({id:id(1),after:first.nextAfter,maxId:first.maxId});
 assert.equal(second.records.length,2);assert.equal(second.records[0].readings[0].previousQuantity,100);assert.equal(second.nextAfter,null);
 assert.deepEqual(second.records.map(r=>r.readings[0].quantity),preparationAuditPage(events).slice(100).map(r=>r.readings[0].quantity));
 assert(!JSON.stringify([a,first,second]).includes('SECRET'));assert(!Object.hasOwn(first.records[0],'reason'));
 await assert.rejects(tools.LOGISTICS_PREPARATION_REGISTER_READ.execute({id:id(999)}),{status:404});
 await assert.rejects(tools.LOGISTICS_PREPARATION_REGISTER_READ.execute({id:id(1),after:100}),{status:400});
 await assert.rejects(tools.LOGISTICS_PREPARATIONS_READ.execute({after:id(1)}),{status:400});
});


test('real logistics session guard rejects customers, inactive users and missing screen rights',async()=>{
 for(const scenario of ['internal','customer','portal','inactive','denied','linked']) {
  const db=database({utenti:[{id:'profile',auth_user_id:'auth',attivo:scenario!=='inactive',ruoli:{nome:scenario==='portal'?'Cliente portale':'Operatore'}}],workspace_customer_user_links:scenario==='linked'?[{user_id:'profile',customer_code:'C1'}]:[],workspace_private_document_customer_access:scenario==='customer'?[{utente_id:'profile',codice_cliente:'C1'}]:[]},(name,args)=>{
   if(name==='workspace_screen_level_for_user'){assert.equal(args.target_screen,'magazzino.allestisci_ordini');return {data:scenario==='denied'?'nessuno':'lettura'};}
   assert.equal(name,'workspace_screen_permission_for_user');return {data:false};
  });
  db.auth={getUser:async()=>({data:{user:{id:'auth'}}})};
  const call=()=>preparationSession({headers:{authorization:'Bearer test-only'}},{admin:db});
  if(scenario==='internal'){const session=await call();assert.equal(session.canWrite,false);}
  else await assert.rejects(call,{status:403});
 }
});

test('own/team scopes and unavailable scope service never expand privileged reads',async()=>{
 for(const scope of [{data:{mode:'team'}},{data:{mode:'propri'}},{data:null},{error:{message:'offline'}}]) {
  const a={...auth,scoped:{rpc:async name=>{assert.equal(name,'workspace_data_scope');return scope;}}};
  let calls=0;
  const p=productionReportTools(a,{run:async()=>{calls++;}}).PRODUCTION_CONSUNTIVI_READ;
  const l=logisticsReadTools(a,{authorize:async()=>{calls++;}}).LOGISTICS_PREPARATIONS_READ;
  await assert.rejects(p.execute({}));await assert.rejects(l.execute({}));assert.equal(calls,0);
 }
});

test('tool pagination accepts a valid previous snapshot and ignores acquisition-only timestamps',async()=>{
 const records=Array.from({length:21},(_,i)=>({...record(i+1),refreshedAt:'2026-11-07T09:00:00Z',stationHistory:{generatedAt:'2026-11-07T09:00:00Z',asOfLocal:'2026-11-07T10:00:00',productivity:2}}));
 const tool=productionReportTools(auth,{run:async()=>({records})}).PRODUCTION_CONSUNTIVI_READ;
 const first=await tool.execute({});assert.equal(first.nextOffset,20);
 records.forEach(r=>{r.refreshedAt='2026-11-07T09:01:00Z';r.stationHistory.generatedAt='2026-11-07T09:01:00Z';r.stationHistory.asOfLocal='2026-11-07T10:01:00';});
 const second=await tool.execute({offset:first.nextOffset,snapshot:first.snapshot});
 assert.equal(second.rows.length,1);assert.equal(second.nextOffset,null);assert.equal(second.snapshot,first.snapshot);
 records[0].stationHistory.productivity=3;
 await assert.rejects(tool.execute({offset:20,snapshot:first.snapshot}),{status:409});
});

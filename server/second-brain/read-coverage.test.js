import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrainCatalog } from './catalog.js';
import { workspaceCostReadTools } from './workspace-cost-reads.js';
import { businessReadTools } from './business-reads.js';
import { validateInput } from './schema.js';
import { validateProgremesQuery } from '../progremes-readonly-client.js';
import { reportPage } from './production-report-reads.js';
import { calculateRecord, defaultSettings } from '../../src/features/production-costs/cost-engine.js';
import { formulaReadTools } from '../ai/formula-revisions.js';
import { displayRecord } from '../../src/features/production-costs/cost-display.js';
import { canReadModule } from '../ai/operational-read.js';
import { canReadDataset } from '../ai/workspace-search.js';

const auth={profile:{id:'reader',ruoli:{}},capabilities:{internal_data:true,allowed_modules:['crm_conto_terzi','progremes'],progremes:true},access:{modules:['crm_conto_terzi','progremes']}};
test('an admin cannot bypass an explicitly restricted AI module perimeter',()=>{
 const a={...auth,profile:{ruoli:{amministratore_workspace:true}},capabilities:{internal_data:true,allowed_modules:[]}};
 assert.equal(canReadModule(a,['progremes']),false);
 assert.equal(canReadDataset(a,'products'),false);
});
test('shared MES archive reads never widen own/team/customer scopes',async()=>{
 for(const scope of [{data:{mode:'propri'}},{data:{mode:'team'}},{data:{mode:'cliente',customer_code:'C1'}},{error:Error('offline')}]) {
  const a={...auth,scoped:{rpc:async name=>{assert.equal(name,'workspace_data_scope');return scope;}}};
  await assert.rejects(businessReadTools(a).MES_READ.execute({resource:'production-orders'}));
 }
});
test('cost reads enforce screen denial and explicit AI scope before archive access',async()=>{
 for(const scope of [auth,{...auth,profile:{id:'admin',ruoli:{amministratore_workspace:true}}}]) {
  assert.deepEqual(workspaceCostReadTools({...scope,capabilities:{...scope.capabilities,allowed_modules:[]}}),{});
  for(const permission of [{data:'nessuno'},{error:Error('offline')}]) {
   const a={...scope,scoped:{rpc:async()=>permission,from(){assert.fail('must not read');}}};
   await assert.rejects(workspaceCostReadTools(a).CRM_WORKSPACE_COSTS_READ.execute({}));
  }
 }
});
test('cost read keeps caller RLS, stored amounts, filters, pagination and errors',async()=>{
 const calls=[];
 const q={then(resolve){return Promise.resolve({data:Array.from({length:51},(_,id)=>({id,amount:123.45,hours:2,hourly_rate:9}))}).then(resolve);}};
 for(const method of ['select','order','gte','lte','eq','range'])q[method]=(...args)=>{calls.push([method,...args]);return q;};
 const a={...auth,admin:{from(){assert.fail('RLS bypass');}},scoped:{rpc:async(name,args)=>{assert.equal(name,'workspace_screen_level_for_user');assert.equal(args.target_user_id,'reader');return {data:'lettura'};},from:table=>{assert.equal(table,'crm_workspace_costs');return q;}}};
 const t=workspaceCostReadTools(a).CRM_WORKSPACE_COSTS_READ;
 const p=await t.execute({from:'2026-01-01',to:'2026-11-08',offset:50});
 assert.equal(p.rows.length,50);assert.equal(p.nextOffset,100);assert.equal(p.rows[0].amount,123.45);
 assert.deepEqual(calls.find(c=>c[0]==='range'),['range',50,100]);
 assert(calls.some(c=>c[0]==='gte'));assert(calls.some(c=>c[0]==='lte'));
 await assert.rejects(t.execute({from:'2026-02-30'}),{status:400});
 assert.throws(()=>validateInput(t.inputSchema,{table:'utenti'}),{status:400});
 q.then=resolve=>Promise.resolve({error:Error('database unavailable')}).then(resolve);
 await assert.rejects(t.execute({}),/database unavailable/);
});
test('MES filters reach the existing allowlist; unsupported combinations stay rejected',()=>{
 const schema=businessReadTools(auth).MES_READ.inputSchema;
 const query={resource:'production-orders',from:'2026-01-01',to:'2026-11-08',status:'Terminato',page:2};
 validateInput(schema,query);
 assert.equal(validateProgremesQuery(query.resource,query).get('status'),'Terminato');
 validateInput(schema,{resource:'articles',active:false,updatedAfter:'2026-11-01T00:00:00Z'});
 assert.equal(validateProgremesQuery('articles',{active:false}).get('active'),'false');
 assert.throws(()=>validateProgremesQuery('status',{page:1}),/Parametro non consentito/);
 assert.throws(()=>validateInput(schema,{resource:'articles',sql:'select *'}));
});
test('coverage is personal metadata and never claims successful archive reads',async()=>{
 const tools=createBrainCatalog({...auth,capabilities:{internal_data:true},access:{modules:[]}});
 const coverage=await tools.BRAIN_DATA_COVERAGE.execute({});
 assert.equal(coverage.readOnly,true);
 assert(!coverage.reads.some(t=>t.name==='PRODUCTION_CONSUNTIVI_READ'));
 assert(!coverage.reads.some(t=>t.name==='CRM_WORKSPACE_COSTS_READ'));
 assert(coverage.authorization.includes('non attestazione'));
});
test('consuntivi expose official time bases and objective comparisons without changing source',()=>{
 const evidence={id:1,state:'Terminato',date:'2026-09-07',unit:'KG',quantity:100,works:[{id:1,phase:'Semilavorato',machineId:1,state:'Terminato',start:'2026-09-07T09:00:00',end:'2026-09-07T16:00:00',goodQuantity:100,personnel:[]}]};
 const r=calculateRecord(evidence,{settings:{...defaultSettings(),laborHourly:20,mixingOperatorsCount:3,machines:[{id:1,gainPerWork:500,washCost:0}]}},{},{octRevenue:1000});
 const before=JSON.stringify(r),row=reportPage([r]).rows[0];
 assert.equal(row.plannedObjective,displayRecord(r).plannedObjective);
 assert.equal(row.plannedObjectiveVariance,displayRecord(r).plannedObjectiveVariance);
 assert.equal(row.phases[0].personHoursInShifts,r.phases[0].personHoursInShifts);
 assert.equal(row.phases[0].actualStandardShiftHours,r.phases[0].actualStandardShiftHours);
 assert(row.semantics.stationObjective.includes('Non è un costo'));
 assert.equal(JSON.stringify(r),before);
 assert(formulaReadTools(auth).MES_RESOURCE_COSTS.description.includes('margine di guadagno auspicato'));
});

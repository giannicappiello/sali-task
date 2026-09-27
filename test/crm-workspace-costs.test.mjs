import test from 'node:test';import assert from 'node:assert/strict';
import {costRows,costSummary,projectCostRows,costCustomerIndex,costClientTree,costEntryPayload} from '../src/modules/crm/workspaceCostModel.js';
const projects=[{id:'p',titolo:'Progetto'}],tasks=[{id:'t',titolo:'Fase',progetto_id:'p'},{id:'s',titolo:'Singola'}];
test('project rollup adds direct and task costs once, standalone stays in total',()=>{const rows=costRows([{id:1,project_id:'p',amount:100},{id:2,phase_id:'t',amount:25},{id:3,phase_id:'s',amount:10}],projects,tasks);assert.deepEqual(costSummary(rows),{total:135,tasks:35,projects:100,count:3});assert.equal(projectCostRows(rows)[0].total,125);});
test('decimal currency sums use cents and zero remains a recorded cost',()=>{const rows=costRows([{phase_id:'t',amount:0.1},{phase_id:'t',amount:0.2},{phase_id:'s',amount:0}],projects,tasks);assert.equal(costSummary(rows).total,0.3);assert.equal(costSummary(rows).count,3);assert.equal(projectCostRows(rows)[0].tasks,0.3);});
test('empty report stays empty',()=>{assert.deepEqual(projectCostRows([]),[]);assert.equal(costSummary([]).total,0);});
test('client hierarchy merges CRM aliases, includes zero-cost active work, and orders projects by creation',()=>{
 const index=costCustomerIndex([{codice_cliente:'1',ragione_sociale:'Alfa'}],[{id:'a',codice_cliente_mexal:'1',nome:'Alfa CRM'}]);
 const ps=[{id:'new',titolo:'Nuovo',created_at:'2026-09-20',crm_customer_key:'crm:a',stato:'aperto'},{id:'old',titolo:'Vecchio',created_at:'2026-09-01',crm_customer_key:'mexal:1',stato:'aperto'}];
 const ts=[{id:'t',titolo:'Fase',progetto_id:'old',stato:'da_evadere'},{id:'solo',titolo:'Singola',crm_customer_key:'mexal:1',stato:'da_evadere'},{id:'closed',titolo:'Chiusa',crm_customer_key:'mexal:1',stato:'evasa'}];
 const costs=costRows([{project_id:'old',amount:20},{phase_id:'t',amount:30},{phase_id:'t',amount:10},{phase_id:'solo',amount:5}],ps,ts);
 const tree=costClientTree(ps,ts,costs,index,{search:'alfa'});
 assert.equal(tree.length,1);assert.deepEqual(tree[0].projects.map(p=>p.id),['old','new']);assert.equal(tree[0].total,65);
 assert.equal(tree[0].projects[0].tasks[0].total,40);assert.deepEqual(tree[0].tasks.map(t=>t.id),['solo']);
 assert.equal(costClientTree(ps,ts,costs,index,{search:'nessuno'}).length,0);
});
test('labor date and operator are editable, tariff multiplication rounds to cents, materials remain separate',()=>{
 const target={kind:'task',target:'t'};
 const labor=costEntryPayload({cost_type:'labor',hours:'1.25',hourly_rate:30,operator_name:' Altra Persona ',cost_date:'2026-08-01',description:''},target);
 assert.equal(labor.amount,37.5);assert.equal(labor.operator_name,'Altra Persona');assert.equal(labor.cost_date,'2026-08-01');assert.equal(labor.phase_id,'t');
 const material=costEntryPayload({cost_type:'materials',amount:'12.50',cost_date:'2026-08-02'},target);
 assert.equal(material.hours,null);assert.equal(material.amount,12.5);
 assert.throws(()=>costEntryPayload({cost_type:'labor',hours:0,hourly_rate:30,operator_name:'Nome',cost_date:'2026-08-01'},target));
 assert.throws(()=>costEntryPayload({cost_type:'materials',amount:'',cost_date:'2026-08-01'},target));
});

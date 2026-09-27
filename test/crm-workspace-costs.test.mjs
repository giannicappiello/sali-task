import test from 'node:test';import assert from 'node:assert/strict';
import {costRows,costSummary,projectCostRows} from '../src/modules/crm/workspaceCostModel.js';
const projects=[{id:'p',titolo:'Progetto'}],tasks=[{id:'t',titolo:'Fase',progetto_id:'p'},{id:'s',titolo:'Singola'}];
test('project rollup adds direct and task costs once, standalone stays in total',()=>{const rows=costRows([{id:1,project_id:'p',amount:100},{id:2,phase_id:'t',amount:25},{id:3,phase_id:'s',amount:10}],projects,tasks);assert.deepEqual(costSummary(rows),{total:135,tasks:35,projects:100,count:3});assert.equal(projectCostRows(rows)[0].total,125);});
test('decimal currency sums use cents and zero remains a recorded cost',()=>{const rows=costRows([{phase_id:'t',amount:0.1},{phase_id:'t',amount:0.2},{phase_id:'s',amount:0}],projects,tasks);assert.equal(costSummary(rows).total,0.3);assert.equal(costSummary(rows).count,3);assert.equal(projectCostRows(rows)[0].tasks,0.3);});
test('empty report stays empty',()=>{assert.deepEqual(projectCostRows([]),[]);assert.equal(costSummary([]).total,0);});

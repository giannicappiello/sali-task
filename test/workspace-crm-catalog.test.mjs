import test from 'node:test';
import assert from 'node:assert/strict';
import { directWorkspaceProducts, projectsForCrmTask, loadDirectWorkspaceProducts } from '../src/lib/workspaceCrmCatalog.js';
import { crmNavigation } from '../src/modules/crm/crmNavigation.js';
import { CRM_ROUTE_CATALOG } from '../src/modules/crm/crmRouteCatalog.js';

test('DIRECT products use IT MKT IMP codes and preserve real product IDs', () => {
  const rows = [{id:'1',codice:'IT01'},{id:'2',codice_mexal:' mkt03 '},{id:'3',codice:'IMP04'},{id:'4',codice:'PR01'},{id:'5',codice_mexal:'PR02',codice:'IT99'}];
  assert.deepEqual(directWorkspaceProducts(rows).map(r=>r.id), ['1','2','3']);
});
test('task projects follow CRM and preselected customer while retaining the edited project', () => {
  const rows = [{id:'b',crm_tipo:'b2b',crm_customer_key:'mexal:1'},{id:'p',crm_tipo:'conto_terzi',crm_customer_key:'mexal:1'},{id:'other',crm_tipo:'b2b',crm_customer_key:'mexal:2'}];
  assert.deepEqual(projectsForCrmTask(rows,'b2b','mexal:1').map(r=>r.id),['b']);
  assert.deepEqual(projectsForCrmTask(rows,'b2b','mexal:1',{progetto_id:'p'}).map(r=>r.id),['b','p']);
  assert.equal(projectsForCrmTask(rows,'').length,3);
});
test('DIRECT loading follows every page and filters server results defensively', async () => {
  let calls=0;const client={from:()=>{const q={select:()=>q,eq:()=>q,or:()=>q,order:()=>q,range:async()=>{calls++;return {data:calls===1?Array.from({length:500},(_,i)=>({id:i,codice:'IT'+i})):[{id:501,codice:'IMP1'},{id:502,codice:'OTHER'}]};}};return q;}};
  const result=await loadDirectWorkspaceProducts(client);assert.equal(result.data.length,501);assert.equal(calls,2);
});
test('B2B Analysis removed without removing PRIVATE analysis', () => {
  assert.equal(crmNavigation('b2b').some(([name])=>name==='Analisi'),false);
  assert.equal(CRM_ROUTE_CATALOG.some(r=>r.path==='b2b/analisi'),false);
  assert.equal(CRM_ROUTE_CATALOG.some(r=>r.path==='conto-terzi/analisi'),true);
});

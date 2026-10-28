/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CRM_ROUTE_CATALOG} from '../../src/modules/crm/crmRouteCatalog.js';
import {scopeBeautyOrders} from '../../src/modules/crm/orderDashboardScope.js';
import {loadDashboardProductRows,loadDashboardProductSummary} from '../../src/modules/crm/dashboardProducts.js';

test('PH and PR are independent B2B screens, scoped product requests retain their module',async()=>{
  const screens=CRM_ROUTE_CATALOG.filter(r=>r.view==='order-dashboard');
  assert.deepEqual(screens.map(s=>s.orderModule),['ph','prof']);
  assert.equal(new Set(screens.map(s=>s.screenCode)).size,2);
  assert.ok(screens.every(s=>s.moduleCode==='crm_b2b'));
  const calls=[],client={rpc(name,args){calls.push({name,args});return {abortSignal:async()=>({data:name.endsWith('summary')?{ordered:1}:[]})};}};
  for(const module of ['ph','prof']){
    await loadDashboardProductSummary(client,{p_order_module:module});
    await loadDashboardProductRows(client,'crm_dashboard_product_detail_lines',{p_order_module:module,p_product:'IT1'});
  }
  assert.ok(calls.every(c=>c.name.startsWith('crm_b2b_order_product_')));
  assert.deepEqual(calls.map(c=>c.args.p_order_module),['ph','ph','prof','prof']);
});
test('Beauty Days post-event amounts cannot include the other order module',()=>{
  const data={events:[{stato:'eseguita',impact:{orders:[{id:'ph',value:12},{id:'pr',value:50}],order_value:62}}]};
  const result=scopeBeautyOrders(data,['pr']);
  assert.equal(result.events[0].impact.order_value,50);
  assert.equal(data.events[0].impact.order_value,62);
  assert.equal(scopeBeautyOrders(data,[]).events[0].impact.order_value,0);
});
test('SQL product totals separate modules for the same customer and keep authorization', {skip:!process.env.PGLITE_MODULE},async()=>{
  const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
  try{
    await db.exec(await readFile(new URL('./order-dashboard-fixture.sql',import.meta.url),'utf8'));
    const migration=await readFile(new URL('../../supabase/migrations/20261028120000_crm_b2b_order_dashboards.sql',import.meta.url),'utf8');
    const names=['customers','product_rows','product_summary','product_groups','product_detail_lines'];
    for(const name of names){
      const match=migration.match(new RegExp('create or replace function public\\.crm_b2b_order_'+name+'\\([^]*?\\$\\$;','i'));
      assert.ok(match,name);await db.exec(match[0]);
    }
    await db.exec(`insert into ordini_testate values('open-pr','A','2026-09-02','prof','standard','aperto','8',null,8);
    insert into ordini_documenti_mexal values('open-pr','OCM','APERTO',true,now(),'8',2026,'OC'),('open-pr','OCX','APERTO',true,now(),'9',2026,'OC');
    insert into ordini_righe(id,ordine_id,codice_articolo,quantita,quantita_ocm,quantita_ocx,prezzo_netto) values('pr-line','open-pr','PR-ONLY',6,4,2,10);`);
    const args=['b2b','2026-01-01','2026-10-28','1'];
    const summary=module=>db.query('select crm_b2b_order_product_summary($1,$2,$3,$4,$5) data',[...args,module]);
    assert.deepEqual((await summary('ph')).rows[0].data,{ordered:1,purchased:2,reserved:1});
    assert.deepEqual((await summary('prof')).rows[0].data,{ordered:1,purchased:2});
    const groups=(await db.query("select * from crm_b2b_order_product_groups($1,$2,$3,$4,'ordered',500,0,'prof')",args)).rows;
    assert.equal(groups[0].code,'PR-ONLY');assert.equal(Number(groups[0].quantity),6);
    assert.equal(Number(groups[0].documents),2);
    const lines=(await db.query("select * from crm_b2b_order_product_detail_lines($1,$2,$3,$4,'ordered','PR-ONLY',500,0,'prof')",args)).rows;
    assert.equal(lines.length,2);assert.ok(lines.every(l=>l.customer_code==='A'));
    assert.deepEqual((await summary('invalid')).rows[0].data,{});
    await db.exec("set test.visible='D'");assert.deepEqual((await summary('prof')).rows[0].data,{});
  } finally {await db.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterCustomerWorklist, loadCustomerWorklist } from '../../src/modules/crm/crmWorklist.js';
import { beautyDetailEvents } from '../../src/modules/crm/crmBeautyData.js';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const row=(code,category,priority=4)=>({codice_cliente:code,ragione_sociale:'Farmacia '+code,categoria:category,priorita:priority,numero_ordini:category==='da_attivare'?0:1,classificazione:category==='da_attivare'?'prospect':'a_rischio'});
test('single list includes never ordered, first overdue and normal overdue customers, not regular ones',()=>{
 const rows=[row('A','da_attivare'),row('B','primo_ordine_senza_seguito',3),row('C','riordino_in_ritardo',1),row('D',null,6),row('E','nessun_ordine_periodo',5)];
 assert.deepEqual(filterCustomerWorklist(rows).map(x=>x.codice_cliente),['C','B','A','E']);
 assert.deepEqual(filterCustomerWorklist(rows,{category:'da_attivare',search:'  farmacia a '}).map(x=>x.codice_cliente),['A']);
 assert.equal(filterCustomerWorklist(rows,{mode:'reorders'}).length,4);
 assert.equal(filterCustomerWorklist(rows,{segment:'prospect'}).length,1);
});
test('stable priority sort uses due date before customer name',()=>{
 assert.deepEqual(filterCustomerWorklist([{...row('A','da_attivare'),contatto_consigliato_il:'2026-09-12'},{...row('Z','da_attivare'),contatto_consigliato_il:'2026-09-01'}]).map(x=>x.codice_cliente),['Z','A']);
});
test('all authorized customers are paginated, period and abort signal forwarded',async()=>{
 const calls=[];const signal=new AbortController().signal;
 const client={rpc(name,args){return{range(from,to){return{async abortSignal(s){calls.push({name,args,from,to,s});return{data:Array.from({length:from===0?500:2},(_,i)=>({id:from+i})),error:null};}};}};}};
 const result=await loadCustomerWorklist(client,'2026-01-01','2026-09-12',signal);
 assert.equal(result.length,502);assert.equal(calls.length,2);
 assert.deepEqual(calls[0].args,{period_from:'2026-01-01',period_to:'2026-09-12'});
 assert.equal(calls[1].from,500);assert.equal(calls[1].s,signal);
});
test('worklist errors are not converted into empty successful lists',async()=>{
 const error=new Error('denied');const client={rpc(){return{range(){return{async abortSignal(){return{error};}};}};}};
 await assert.rejects(loadCustomerWorklist(client,'2026-01-01','2026-09-12'),error);
});
test('SQL preserves caller RLS, one row per canonical customer, distinct days and date range',()=>{
 const sql=read('supabase/migrations/20260913001000_crm_b2b_followup_worklist.sql');
 assert.match(sql,/security invoker/);assert.match(sql,/crm_has_module_level\('crm_b2b','lettura'\)/);
 assert.match(sql,/c.area_crm='b2b' and c.crm_active/);
 assert.match(sql,/group by o.codice_cliente,o.purchase_date/);
 assert.match(sql,/o.data_ordine<=period_to/);assert.match(sql,/d.purchase_date>=period_from/);
 assert.doesNotMatch(sql,/update public|delete from|insert into/i);
});
test('Beauty pharmacy summaries preserve canonical code and render the shared customer link',()=>{
 const grouped=beautyDetailEvents([{id:'e1',customer_code:'501.00270',customer_name:'Farmacia',data:'2026-07-01',stato:'eseguita'},{id:'e2',customer_code:'501.00270',data:'2026-07-31',stato:'eseguita'}],'customers');
 assert.equal(grouped.length,1);assert.equal(grouped[0].customer_code,'501.00270');
 const code=read('src/modules/crm/CrmBeautyEventTable.jsx');
 assert.match(code,/<CrmCustomerLink crmType="b2b" customerCode=\{event.customer_code\}/);
 const link=read('src/modules/crm/CrmCustomerLink.jsx');
 assert.match(link,/location.search/);assert.match(link,/state=\{\{ from:/);
});

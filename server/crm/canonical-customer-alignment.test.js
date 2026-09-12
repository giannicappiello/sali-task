import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crmFunctionError } from '../../src/modules/crm/crmFunctionError.js';
const read = p => readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20260912233000_canonical_crm_reactivated_customers.sql');
test('Beauty CRM uses existing canonical sources under caller RLS',()=>{
 const code=read('supabase/functions/report-giornate-api/crmBeautyData.js');
 assert.match(code,/from\("ordini_clienti_cache"\)/);
 assert.doesNotMatch(code,/from\("mexal_clienti_cache"\)/);
 assert.match(code,/from\("crm_order_kpi_source"\)/);
 assert.match(code,/from\("mexal_fatture_vendita"\)/);
 const edge=read('supabase/functions/report-giornate-api/index.ts');
 assert.match(edge,/loadCrmBeautyDashboard\(scopedPrimary, report/);
 assert.match(edge,/loadCrmBeautyCustomer\(scopedPrimary, report/);
});
test('recovery lives on canonical records, is auditable and targets only authorized reactivations',()=>{
 assert.match(sql,/alter table public.ordini_clienti_cache/);
 assert.doesNotMatch(sql,/create table|set cod_alternativo|set nome_ricerca_cf|set codice_agente_mexal/i);
 assert.match(sql,/previous_exclusion'->'snapshot'->>'area_crm/);
 assert.match(sql,/audit_count not in \(0,23\)/);
 assert.match(sql,/customer_crm_classification_restored/);
 assert.match(sql,/reactivation_history/);
});
test('single and full refresh share one effective classification and exclusion predicate',()=>{
 assert.equal((sql.match(/public.crm_customer_effective_area\(c.cod_alternativo,c.nome_ricerca_cf,c.crm_restored_area\)/g)||[]).length,3);
 assert.match(sql,/c.attivo_mexal is true and c.sync_excluded is false/);
 assert.match(sql,/new.crm_restored_area:=null/);
 assert.match(sql,/new.crm_restore_reference:=null/);
});
test('HTTP errors expose actual endpoint message without consuming response',async()=>{
 const response=new Response(JSON.stringify({error:'Impossibile leggere i dati Beauty Days'}),{status:500});
 const error=new Error('Edge Function returned a non-2xx status code'); error.context=response;
 assert.equal((await crmFunctionError(error)).message,'Impossibile leggere i dati Beauty Days');
 assert.equal(response.bodyUsed,false);
 error.context=new Response('not json',{status:500});
 assert.equal(await crmFunctionError(error),error);
 assert.equal((await crmFunctionError({message:'Network offline'})).message,'Network offline');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260915120000_director_direct_customer_scope.sql');
const hook = read('src/modules/orders/pages/useOrdersAccess.js');

function permissions({ moduleCode='prof', direct=true, customerCode=null, enabled=true, canRead=true, canWrite=true }={}) {
  const start = hook.indexOf('    const canReadModule =');
  const end = hook.indexOf('\n  }, [access, canUseModule', start);
  return vm.runInNewContext(`(function(){${hook.slice(start,end)}})()`, {
    access:{enabled,ruolo_ordini:customerCode?'cliente':'area_manager',agenti_gestiti:['OWN']},
    workspaceModuleCode:moduleCode==='private'?'ordini_private':moduleCode==='ph'?'ordini_ph':'ordini_pr',
    canUseModule:(_module,level)=>level==='lettura'?canRead:level==='scrittura'?canWrite:false,
    customerCode,customerCodes:customerCode?[customerCode]:[],privateReadOnly:false,
    directCustomerRead:direct&&['prof','ph'].includes(moduleCode)&&!customerCode,
    commercialMode:'team',scopeMode:'team',
  });
}

test('director can search all authorized direct customers in both PR and PH, without admin rights',()=>{
  for(const moduleCode of ['prof','ph']) {
    const p=permissions({moduleCode});
    assert.equal(p.canSeeAll,true);
    assert.equal(p.visibleAgents,null);
    assert.equal(p.canWriteOrders,true);
    assert.equal(p.canWriteAll,false);
    assert.equal(p.isAdmin,false);
    assert.equal(p.canManageOrders,false);
  }
});
test('PRIVATE and non-director agent scopes are unchanged',()=>{
  for(const args of [{moduleCode:'private'},{direct:false}]) {
    const p=permissions(args);
    assert.equal(p.canSeeAll,false);
    assert.deepEqual(Array.from(p.visibleAgents),['OWN']);
  }
});
test('linked customers and module permissions still take precedence',()=>{
  for(const args of [{customerCode:'ONLY'},{enabled:false},{canRead:false}]) {
    assert.equal(permissions(args).canSeeAll,false);
  }
  assert.equal(permissions({canWrite:false}).canWriteOrders,false);
});
test('server scope is role based, active-user only, independent of agents and excludes PRIVATE',()=>{
  assert.match(migration,/lower\(btrim\(nome\)\) = 'direzione'/);
  assert.match(migration,/r.role_id=u.ruolo_id/);
  assert.match(migration,/u.attivo is not false/);
  assert.match(migration,/not exists\(select 1 from public.workspace_customer_user_links/);
  assert.match(migration,/crm_customer_effective_area\(c.cod_alternativo,c.nome_ricerca_cf,c.crm_restored_area\) in \('b2b','online'\)/);
  assert.match(migration,/c.sync_excluded is false/);
  assert.doesNotMatch(migration,/Noemi|Merino|602\.00053|501\.02147|update public.utenti|update public.ruoli/i);
  assert.match(migration,/direct_codes as materialized/);
  assert.match(migration,/modulo_ordini in \('prof','ph'\)/);
  assert.match(migration,/crm_has_module_level[\s\S]*'scrittura'/);
  assert.match(migration,/h.stato='bozza'/);
  assert.match(migration,/revoke all on function[\s\S]*from public,anon/);
});
test('client refreshes the separate direct capability without widening operational scope',()=>{
  assert.match(read('src/contexts/AuthContext.jsx'),/directCustomerRead: scope.direct_customer_read === true/);
  assert.match(hook,/\["prof", "ph"\]\.includes\(moduleCode\) && !customerCode/);
  assert.match(hook,/privateReadOnly, directCustomerRead\]\);/);
  assert.match(migration,/workspace_access_revision set revision=revision\+1/);
});

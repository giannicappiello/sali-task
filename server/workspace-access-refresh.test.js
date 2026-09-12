import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accessSnapshotSignature, retainEqualAccessValue, retainAccessProfile } from '../src/config/workspaceAccessSnapshot.js';

const source = readFileSync(new URL('../src/contexts/AuthContext.jsx', import.meta.url), 'utf8');
const loadCode = source.slice(source.indexOf('  async function loadProfile('), source.indexOf('  async function signIn('));
function harness() {
  const requests = [], state = {}, loadGeneration = { current: 0 }, currentAuthId = { current: 'one' };
  const names = [...new Set([...loadCode.matchAll(/\b(set[A-Z]\w*)\(/g)].map(m => m[1]))];
  const supabase = { rpc(name) { assert.equal(name, 'workspace_session_access'); return new Promise(resolve => requests.push(resolve)); } };
  const fn = new Function('supabase','ensureProfile','loadGeneration','currentAuthId','accessRevision','lastAccessSignature','EMPTY_DATA_SCOPE',
    'accessSnapshotSignature','retainEqualAccessValue','retainAccessProfile',...names,
    `${loadCode}; return loadProfile;`)(supabase,async()=>{},loadGeneration,currentAuthId,{current:null},{current:''},{},
      accessSnapshotSignature,retainEqualAccessValue,retainAccessProfile,...names.map(n=>v=>{
        state[n]=typeof v === 'function' ? v(n === 'setAccessEpoch' ? state[n] || 0 : state[n]) : v;
      }));
  return { fn, requests, state, loadGeneration, currentAuthId };
}
const snapshot = (departments) => ({ data: { profile: { id: 'one', attivo: true }, access: { department_ids: departments, role: {}, modules: departments }, screen_levels: {}, scope: { mode: 'team', department_ids: departments } } });
test('commercial visibility refresh never promotes operational scope and revocation remounts readers', async () => {
  const h = harness(), enabled = snapshot(['marketing']), revoked = snapshot(['marketing']);
  enabled.data.scope.commercial_mode = 'tutti';
  revoked.data.scope.commercial_mode = 'team';
  let run = h.fn({id:'one'}, {refresh:true}); h.requests.shift()(enabled); await run;
  assert.equal(h.state.setDataScope.mode, 'team');
  assert.equal(h.state.setDataScope.commercialMode, 'tutti');
  run = h.fn({id:'one'}, {refresh:true}); h.requests.shift()(revoked); await run;
  assert.equal(h.state.setDataScope.commercialMode, 'team');
  assert.deepEqual(h.state.setDataScope.departmentIds, ['marketing']);
  assert.equal(h.state.setAccessEpoch, 1);
});
test('department refresh replaces old memberships and grants, never merges', async () => {
  const h = harness();
  let run = h.fn({id:'one'}, {refresh:true}); h.requests.shift()(snapshot(['old'])); await run;
  run = h.fn({id:'one'}, {refresh:true}); h.requests.shift()(snapshot(['new'])); await run;
  assert.deepEqual(h.state.setProfile.reparto_ids,['new']);
  assert.deepEqual(h.state.setModuleAccess,['new']);
  assert.deepEqual(h.state.setDataScope.departmentIds,['new']);
  assert.equal(h.state.setAccessEpoch, 1, 'open pages must discard their previous local data scope');
});
test('a late previous snapshot cannot restore revoked permissions', async () => {
  const h=harness(), old=h.fn({id:'one'},{refresh:true}), fresh=h.fn({id:'one'},{refresh:true});
  h.requests[1](snapshot(['new'])); await fresh;
  h.requests[0](snapshot(['old'])); await old;
  assert.deepEqual(h.state.setProfile.reparto_ids,['new']);
});
test('disable or failed refresh clears cached grants', async () => {
  const h=harness();
  let run=h.fn({id:'one'},{refresh:true}); h.requests.shift()(snapshot(['old'])); await run;
  run=h.fn({id:'one'},{refresh:true}); h.requests.shift()({data:{profile:null}}); await run;
  assert.equal(h.state.setProfile,null); assert.deepEqual(h.state.setModuleAccess,[]);
  run=h.fn({id:'one'},{refresh:true}); h.requests.shift()({error:Error('offline')});
  await assert.rejects(run,/offline/); assert.deepEqual(h.state.setPermissions,[]);
});
test('late snapshot after sign-out does not restore a profile', async () => {
  const h=harness(), run=h.fn({id:'one'},{refresh:true});
  h.currentAuthId.current=null; h.loadGeneration.current++;
  h.requests.shift()(snapshot(['old'])); await run;
  assert.equal(h.state.setProfile,undefined);
});

test('identical and reordered snapshots retain references without remounting CRM pages', async () => {
  const h = harness();
  let run = h.fn({id:'one'}, {refresh:true});
  h.requests.shift()(snapshot(['first', 'second'])); await run;
  const before = {...h.state};
  run = h.fn({id:'one'}, {refresh:true});
  const next = snapshot(['second', 'first']);
  next.data.revision = 42;
  h.requests.shift()(next); await run;
  for (const key of ['setProfile','setPermissions','setModuleAccess','setModuleLevels','setAccessExceptions','setAreaAccess','setModuleAreas','setScreenCatalog','setDataScope']) {
    assert.equal(h.state[key], before[key], key + ' should remain referentially stable');
  }
  assert.equal(h.state.setAuthorizationRevision, 42);
  assert.equal('setAccessEpoch' in h.state, false);
});

test('presence changes preserve the role and department references used by access callbacks', () => {
  const original = {id:'one', attivo:true, ruoli:{nome:'Direzione'}, reparto_ids:['a'], reparti_multipli:[{id:'a',nome:'Field Force'}], last_seen:'before'};
  const next = retainAccessProfile(original, {...structuredClone(original), last_seen:'after'});
  assert.equal(next.last_seen, 'after');
  assert.equal(next.ruoli, original.ruoli);
  assert.equal(next.reparto_ids, original.reparto_ids);
  assert.equal(next.reparti_multipli, original.reparti_multipli);
});

test('revocation and expiry still invalidate page-local data', async () => {
  const h = harness();
  let run = h.fn({id:'one'}, {refresh:true});
  const initial = snapshot(['a']);
  initial.data.screen_levels = {'crm.b2b.dashboard':'lettura'};
  h.requests.shift()(initial); await run;
  run = h.fn({id:'one'}, {refresh:true});
  const revoked = snapshot(['a']);
  revoked.data.screen_levels = {'crm.b2b.dashboard':'nessuno'};
  h.requests.shift()(revoked); await run;
  assert.equal(h.state.setAccessEpoch, 1);
  assert.equal(h.state.setScreenCatalog.levels['crm.b2b.dashboard'], 'nessuno');
});

const migration = readFileSync(new URL('../supabase/migrations/20260912150000_workspace_access_consistency.sql', import.meta.url),'utf8');
test('roles supply operations; departments and personal grants supply areas', () => {
  const areas=migration.slice(migration.indexOf('create or replace function public.workspace_area_access_codes'),migration.indexOf('create or replace function public.workspace_operation_codes'));
  assert.doesNotMatch(areas,/workspace_ruoli_aree/);
  assert.match(areas,/workspace_utenti_aree/);
  assert.match(migration,/join permessi_ruolo pr/);
  assert.match(migration,/workspace_no_primary_department check\(reparto_id is null\)/);
});
test('revision broadcasts are content-free and presence changes are excluded', () => {
  assert.match(migration,/grant select on workspace_access_revision to authenticated/);
  assert.doesNotMatch(migration,/after update of[^\n]*last_seen/);
  assert.match(source,/postgres_changes.*workspace_access_revision/);
  assert.match(source,/window\.addEventListener\("focus", onFocus\)/);
  assert.match(source,/setInterval\(\(\) => void refresh\(\), 30000\)/);
});

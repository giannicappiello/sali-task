import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadDataset, searchWorkspace, workspaceReadTools } from './workspace-search.js';

const user = (modules = ['prodotti'], allowed = ['prodotti']) => ({
  capabilities: { internal_data: true, allowed_modules: allowed },
  profile: { ruoli: {} }, access: { modules },
});
test('AI access requires both business entitlement and AI scope', () => {
  assert.equal(canReadDataset(user(), 'products'), true);
  assert.equal(canReadDataset(user([], ['prodotti']), 'products'), false);
  assert.equal(canReadDataset(user(['prodotti'], []), 'products'), false);
  assert.equal(canReadDataset(user(), 'documents'), false);
  assert.equal(canReadDataset(user(), 'constructor'), false);
  assert.equal(canReadDataset({}, 'products'), false);
  assert.deepEqual(workspaceReadTools(user([], [])), {});
});
test('denied searches never touch the database', async () => {
  const auth = user([], []);
  auth.scoped = { from() { assert.fail('unauthorized database access'); } };
  await assert.rejects(searchWorkspace(auth, { dataset: 'products' }), { status: 403 });
});
test('read uses user-scoped client, fixed projection and pagination', async () => {
  const calls = [];
  const query = { then(resolve) { resolve({ data: [{ id:'p1' }], count: 80 }); } };
  for (const method of ['select','order','range','eq','ilike']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  const auth = user();
  auth.scoped = { from(table) { calls.push(['from',table]); return query; } };
  auth.admin = { from() { assert.fail('must not bypass RLS'); } };
  const result = await searchWorkspace(auth, { dataset:'products', id:'p1', columns:'*', table:'utenti' });
  assert.deepEqual(calls[0], ['from','prodotti']);
  assert.equal(calls.find(c => c[0] === 'select')[1].includes('*'), false);
  assert.equal(result.nextOffset, 50);
  assert.deepEqual(calls.find(c => c[0] === 'range'), ['range',0,49]);
  await assert.rejects(searchWorkspace(auth, { dataset:'products',offset:-1 }), /Pagina non valida/);
});
test('database failure is not reported as an empty result', async () => {
  const failure = new Error('unavailable');
  const query = {select(){return this;},order(){return this;},range(){return this;},then(resolve){resolve({error:failure});}};
  const auth = user(); auth.scoped = {from(){return query;}};
  await assert.rejects(searchWorkspace(auth,{dataset:'products'}), failure);
});

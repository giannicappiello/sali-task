import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadProductionSpecification } from './production-specification-access.js';
test('packaging reader can view specification, sources, saved images and history', async () => {
  const admin = { rpc: async (name, args) => {
    assert.equal(name, 'workspace_screen_level_for_user'); assert.equal(args.target_user_id, 'operator');
    return { data: args.target_screen === 'progremes.OperatoreConfezionamento' ? 'lettura' : 'nessuno' };
  } };
  for (const path of ['/specifications', '/specifications/sources', '/specifications/file', '/specifications/history']) assert.equal(await canReadProductionSpecification(admin, 'operator', path), true);
});
test('production permission never grants editing, NAS browsing or other private documents', async () => {
  const admin = { rpc: () => { throw new Error('must not consult production grants'); } };
  for (const path of ['/specifications/save', '/specifications/preview', '/nas', '/nas/sync', '/documents/reference', '/documents/1', '/specifications-other']) assert.equal(await canReadProductionSpecification(admin, 'operator', path), false);
});
test('missing, denied and unknown levels do not grant access', async () => {
  const from = () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null }) }; return q; };
  for (const data of [null, 'nessuno', '', 'unknown']) assert.equal(await canReadProductionSpecification({ from, rpc: async () => ({ data }) }, 'operator', '/specifications'), false);
  await assert.rejects(canReadProductionSpecification({ rpc: async () => ({ error: new Error('permission service unavailable') }) }, 'operator', '/specifications'), /permission service unavailable/);
});

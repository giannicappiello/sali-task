import test from 'node:test';
import assert from 'node:assert/strict';
import { propagateDeletedOcts } from './propagate-deleted-octs.js';
import { visibleWorkbenchOct } from '../workspacemes-workbench.js';
import { createProgremesProductionClient } from '../progremes-production-client.js';
import { HMAC_HEADERS, verifyProductionMessage } from '../progremes-production-hmac.js';

test('OCT deletion carries a valid event identity and HMAC accepted by MES', async () => {
  const id = 'c5e5228a-cfba-41fa-bfd4-b19e83d485da';
  const secret = 'oct-deletion-test-secret';
  const client = createProgremesProductionClient({ env: { PROGREMES_URL: 'https://mes.example.com', PROGREMES_INTEGRATION_SECRET: secret },
    fetchImpl: async (url, request) => {
      assert.equal(request.headers[HMAC_HEADERS.eventId], id);
      assert.equal(verifyProductionMessage({ method: request.method, path: url.pathname, headers: request.headers, body: request.body, secret }), true);
      return { ok: true, json: async () => ({ workspaceOctId: id, status: 'DELETED' }) };
    } });
  await client.deleteOct({ contractVersion: 4, workspaceOctId: id });
});

function fixture() {
  const job = { order_id: 'order', generation: 'generation', payload: { workspaceOctId: 'order', octReference: 'OC/2/1' } };
  const calls = [];
  const db = { from() { const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; },
    update(patch) { calls.push(patch); return q; }, then(resolve) { return Promise.resolve({ data: [job], error: null }).then(resolve); } }; return q; },
    async rpc(name, args) { calls.push({ name, args }); return { data: true }; } };
  return { db, calls, job };
}
test('MES deletion is acknowledged only after identity and final status match', async () => {
  const f = fixture();
  const result = await propagateDeletedOcts({ supabase: f.db, client: { deleteOct: async payload => {
    assert.equal(payload, f.job.payload); return { result: { workspaceOctId: 'order', status: 'DELETED' } };
  } } });
  assert.equal(result.mes_deleted_octs, 1); assert.equal(f.calls[0].args.p_generation, 'generation');
});
test('old MES, timeout and partial deletion remain pending for retry', async () => {
  for (const response of [new Error('MES non aggiornato'), { status: 'DELETED', workspaceOctId: 'another' },
    { status: 'PARTIAL', workspaceOctId: 'order', blockers: ['OP1: da stornare'] }]) {
    const f = fixture();
    const result = await propagateDeletedOcts({ supabase: f.db, client: { deleteOct: async () => {
      if (response instanceof Error) throw response; return { result: response };
    } } });
    assert.equal(result.mes_deletion_pending, 1); assert.equal(f.calls.length, 1); assert.ok(f.calls[0].args.p_error);
  }
});
test('completed MES deletion hides an OCT even with historical links', () => {
  assert.equal(visibleWorkbenchOct({ sourceDeletedAt: 'date', mesDeletedAt: 'date', requestId: 'rdp', productionOrders: [{ id: 1 }] }), false);
  assert.equal(visibleWorkbenchOct({ sourceDeletedAt: 'date', requestId: 'rdp' }), true);
});

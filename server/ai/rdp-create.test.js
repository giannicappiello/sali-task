import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeRdpCreation, demandFingerprint, validateRdpSnapshot, rdpCreationTools } from './rdp-create.js';
import { availableControlledActions } from './controlled-actions.js';
import { createWorkspaceRdp } from '../workspace-rdp-create.js';

const demand = { contractVersion: 4, orders: [{ orderId: 'oc', versionHash: 'version' }], items: [{ lineId: 'line', requestedQuantity: 3000, commercialArticleCode: 'FPCOM42' }] };
function snapshotAuth(overrides = {}) {
  const record = { id: 1, requested_by: 'owner', captured_at: new Date().toISOString(), snapshot: demand, ...overrides };
  return { admin: { from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: record }; } }) } };
}
const deps = { authorize: async () => ({ authUserId: 'owner' }), build: async () => demand };

test('RDP creation is exposed to MES writers, not read-only users or manual planning', () => {
  const admin = { profile: { ruoli: { amministratore_workspace: true } }, capabilities: { internal_data: true, progremes: true } };
  assert.ok(availableControlledActions(admin).RDP_CREATE);
  assert.ok(rdpCreationTools(admin, true).RDP_ORDER_LOOKUP);
  assert.equal(availableControlledActions({ ...admin, manualPlanning: true }).RDP_CREATE, undefined);
  assert.equal(availableControlledActions({ profile: { ruoli: {} }, capabilities: { progremes: true, role_ai_level: 'analisi' } }).RDP_CREATE, undefined);
  assert.deepEqual(rdpCreationTools({ capabilities: {} }, true), {});
});

test('fresh MES permission is required even with a cached admin profile', async () => {
  const auth = { profile: { ruoli: { amministratore_workspace: true } }, capabilities: { internal_data: true, progremes: true }, scoped: { rpc: async () => ({ data: false }) } };
  await assert.rejects(authorizeRdpCreation(auth), e => e.status === 403);
});

test('snapshot rejects another owner, expiration and changed demand', async () => {
  await assert.rejects(validateRdpSnapshot(snapshotAuth({ requested_by: 'other' }), '1', deps), e => e.status === 403);
  await assert.rejects(validateRdpSnapshot(snapshotAuth({ captured_at: '2020-01-01' }), '1', deps), /scaduta/);
  await assert.rejects(validateRdpSnapshot(snapshotAuth(), '1', { ...deps, build: async () => ({ ...demand, items: [{ ...demand.items[0], requestedQuantity: 6000 }] }) }), /modificati/);
  assert.deepEqual((await validateRdpSnapshot(snapshotAuth(), '1', deps)).lineIds, ['line']);
});

test('fingerprint ignores only MES contract metadata, not quantities or source versions', () => {
  assert.equal(demandFingerprint(demand), demandFingerprint({ ...demand, items: [{ commercialArticleCode: 'FPCOM42', requestedQuantity: 3000, lineId: 'line' }] }));
  assert.equal(demandFingerprint(demand), demandFingerprint({ ...demand, items: demand.items.map(i => ({ ...i, nettingOwner: 'PROGREMES', workspaceAvailabilityAuthoritative: false })) }));
  assert.notEqual(demandFingerprint(demand), demandFingerprint({ ...demand, orders: [{ ...demand.orders[0], versionHash: 'changed' }] }));
});

test('shared creation preserves selected lines, actor and guarded recorder; only previews MES', async () => {
  let saved;
  const result = await createWorkspaceRdp({ admin: { from: () => ({ update(value) { saved = value; return this; }, eq: async () => ({}) }) },
    lineIds: ['line'], snapshotId: '1', requestedBy: 'owner', recordRpc: 'record_ai_workspace_production_demand' }, {
    prepare: async input => { assert.deepEqual(input.lineIds, ['line']); assert.equal(input.recordRpc, 'record_ai_workspace_production_demand'); assert.equal(input.requestedBy, 'owner'); return { request: { id: 'rdp', external_id: 'external' } }; },
    preview: async input => { assert.equal(input.requestId, 'rdp'); return { id: 'preview', status: 'READY' }; },
  });
  assert.equal(result.requestId, 'rdp'); assert.equal(result.productionCreated, false); assert.equal(saved.workspace_status, 'READY');
});

test('MES preview failure reports the already-created RdP, so it is not created again', async () => {
  const result = await createWorkspaceRdp({ admin: { from: () => ({ update() { return this; }, eq: async () => ({}) }) } }, {
    prepare: async () => ({ request: { id: 'rdp', external_id: 'external' } }),
    preview: async () => { throw Object.assign(new Error('Distinta mancante'), { code: 'BOM_MISSING' }); },
  });
  assert.equal(result.requestId, 'rdp'); assert.equal(result.status, 'BLOCKED'); assert.equal(result.previewError.code, 'BOM_MISSING');
});

test('persistence failure is not misreported as a completed request', async () => {
  await assert.rejects(createWorkspaceRdp({ admin: { from: () => ({ update() { return this; }, eq: async () => ({ error: Error('Database unavailable') }) }) } }, {
    prepare: async () => ({ request: { id: 'rdp' } }), preview: async () => ({ status: 'READY' }),
  }), /Database unavailable/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosePlanningVersion, readActionStatus, recoveryTools, createRecoveryStep } from './operation-recovery.js';
import { planningRequestSchema } from './planning-lifecycle.js';

const version = () => ({ id: 'preview', kind: 'RECALCULATE', status: 'PROPOSED', createdAt: new Date().toISOString(), snapshot: {
  input: { kind: 'RECALCULATE' }, blocks: ['OP5284: formula modificata'], shortages: [{ orderId: 6446, phase: 0, code: 'MP2044', quantity: 2145.903 }],
  tasks: [{ orderId: 6446, type: 3 }, { orderId: 5284, type: 0 }], requirements: [{ orderId: 6446, phase: 0 }],
  impacts: [{ orderId: 5284, reason: 'capacità condivisa' }],
} });
test('targeted diagnosis preserves unrelated blocks, derived impacts and preparation shortages', () => {
  const v = version(); const result = diagnosePlanningVersion(v, 6446);
  assert.equal(result.previewChecksPass, false);
  assert.equal(result.nextStep, 'INSPECT_AND_RESIMULATE');
  assert.deepEqual(result.blocks, v.snapshot.blocks);
  assert.deepEqual(result.shortages, v.snapshot.shortages);
  assert.deepEqual(result.impacts, v.snapshot.impacts);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].orderId, 6446);
  assert.equal(v.snapshot.tasks.length, 2);
});
test('uncertain releases request verification instead of another application', () => {
  for (const status of ['PREPARING', 'RECONCILIATION_REQUIRED']) {
    const result = diagnosePlanningVersion({ ...version(), status }, 6446);
    assert.equal(result.nextStep, 'VERIFY_EXISTING_RELEASE');
    assert.equal(result.previewChecksPass, false);
  }
  assert.equal(diagnosePlanningVersion({ ...version(), status: 'APPLIED' }, 6446).nextStep, 'READ_CURRENT_STATE');
  assert.equal(diagnosePlanningVersion({ ...version(), createdAt: '2020-01-01' }, 6446).nextStep, 'RESIMULATE');
});
test('AI supports actual MES graphical phase fields without exposing internal replan kinds', () => {
  const p = planningRequestSchema.properties;
  assert.ok(p.kind.enum.includes('GRAPHICAL_RELEASE'));
  assert.ok(!p.kind.enum.includes('AUTO_REPLAN'));
  assert.deepEqual(p.moves.items.properties.phase.enum, [0, 3]);
  assert.deepEqual(p.releasePhases.items.properties.phase.enum, [0, 3, 7]);
  assert.equal(p.moves.items.additionalProperties, false);
});
test('action readback is scoped to current owner and propagates lookup failures', async () => {
  const filters = [];
  const query = { select: value => { assert.ok(value.includes('occurred_at')); return query; }, eq: (...args) => { filters.push(args); return query; }, maybeSingle: async () => ({ data: null }) };
  const auth = { profile: { id: 'owner' }, scoped: { from: () => query } };
  await assert.rejects(readActionStatus(auth, 'action'), /non trovata/);
  assert.deepEqual(filters, [['id', 'action'], ['user_id', 'owner']]);
  assert.deepEqual(recoveryTools({ capabilities: {} }, false), {});
});

test('a failed application forces one available diagnostic read, never a blind write retry', () => {
  const prepare = createRecoveryStep({ MES_PLAN_STATUS: {}, MES_PLAN_APPLY: {} }, true);
  assert.equal(prepare({ stepNumber: 0, steps: [] }).toolChoice, 'required');
  const step = { stepNumber: 2, steps: [{ content: [{ type: 'tool-error', toolName: 'MES_PLAN_APPLY', error: new Error('blocked') }] }] };
  assert.deepEqual(prepare(step), { toolChoice: 'required', activeTools: ['MES_PLAN_STATUS'] });
  assert.deepEqual(prepare(step), { toolChoice: 'auto' });
  const denied = createRecoveryStep({ MES_PLAN_STATUS: {} }, false);
  step.steps[0].content[0].error.status = 403;
  assert.deepEqual(denied(step), { toolChoice: 'auto' });
});

test('a successful HTTP simulation containing business blocks also triggers diagnosis', () => {
  const prepare = createRecoveryStep({ MES_PLAN_DIAGNOSE: {}, MES_PLAN_SIMULATE: {} }, false);
  const step = { stepNumber: 2, steps: [{ content: [{ type: 'tool-result', toolName: 'MES_PLAN_SIMULATE', output: version() }] }] };
  assert.deepEqual(prepare(step), { toolChoice: 'required', activeTools: ['MES_PLAN_DIAGNOSE'] });
  assert.deepEqual(prepare(step), { toolChoice: 'auto' });
});

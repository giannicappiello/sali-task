import test from 'node:test';
import assert from 'node:assert/strict';
import { createHrPlanReader, readActiveProductionPlan } from './hr-active-production-plan.js';
import { calendarRows } from './hr-production-calendar.js';
import { verifyProductionMessage } from './progremes-production-hmac.js';

const task = { orderId: 7, orderNumber: 'OP7', articleCode: 'PF7', description: 'Prodotto', type: 0, status: 0, resourceId: 4, start: '2026-09-21T08:00:00', end: '2026-09-21T16:00:00', operatoriIds: [99] };
const state = { configuration: { active: true, activeVersionId: 'v1' }, demands: [], resources: [{ id: 4, code: 'ST4', description: 'Station 4' }] };
const version = tasks => ({ id: 'v1', status: 'APPLIED', snapshot: { tasks, resources: state.resources, operators: [{ id: 99, description: 'Private' }] } });

test('reads the active planning version, including forecasts absent from persisted operations', async () => {
  const calls = [];
  const plan = await readActiveProductionPlan(async (operation, input) => {
    calls.push([operation, input]);
    return operation === 'state' ? state : version([task, { ...task, orderId: -8, type: 3 }]);
  }, () => assert.fail('Must not read legacy archive when a plan is active'));
  assert.deepEqual(calls, [['state', undefined], ['get', { id: 'v1' }]]);
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[1].status, 'Previsione');
  assert.equal(plan.items[0].resource, 'ST4 · Station 4');
  assert.equal('operatoriIds' in plan.items[0], false);
  assert.equal(calendarRows(plan.items, ['Production'], '2026-09-01', '2026-09-30').length, 1);
  assert.equal(calendarRows(plan.items, ['Packaging'], '2026-09-01', '2026-09-30').length, 1);
});
test('legacy fallback only when lifecycle is explicitly inactive; errors never become empty calendars', async () => {
  assert.equal((await readActiveProductionPlan(async () => ({ configuration: { active: false } }), async () => [task])).items.length, 1);
  await assert.rejects(readActiveProductionPlan(async () => { throw new Error('offline'); }, () => assert.fail('no silent fallback')), /offline/);
  await assert.rejects(readActiveProductionPlan(async op => op === 'state' ? state : { ...version([task]), status: 'PROPOSED' }), /non valida/);
});
test('cancelled and historical orders are excluded, department phases retained', async () => {
  const plan = await readActiveProductionPlan(async op => op === 'state' ? { ...state, demands: [{ productionOrderId: 7, stage: 'CANCELLED' }] } : version([task, { ...task, orderId: 8, type: 1 }]));
  assert.deepEqual(plan.items, []);
});
test('signed read transport cannot send simulated or write operations or caller-supplied actor', async () => {
  const secret = 'test-secret';
  const reader = createHrPlanReader({ base: 'https://mes.example', secret, transport: async (url, options) => {
    assert.equal(url.pathname, '/api/workspace/ai/planning/get');
    assert.equal(verifyProductionMessage({ method: options.method, path: url.pathname, headers: options.headers, body: options.body, secret }), true);
    assert.deepEqual(JSON.parse(options.body), { id: 'v1', actor: 'workspace:hr-production-calendar' });
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => version([task]) };
  } });
  await reader('get', { id: 'v1', actor: 'spoof', input: { kind: 'RELEASE_ODL' } });
  await assert.rejects(reader('simulate'), /sola lettura/);
});

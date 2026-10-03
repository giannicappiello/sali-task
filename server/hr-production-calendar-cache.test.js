import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionPlanCache, productionCalendarRequest } from './hr-production-calendar.js';
import { readActiveProductionPlan } from './hr-active-production-plan.js';
import { calendarFailure, calendarNotModified, calendarUpdatedLabel } from '../src/pages/Dashboard/productionCalendarState.js';

test('slow reads coalesce even after TTL and expiry starts at completion', async () => {
  let now = 0, calls = 0, release;
  const plan = { items: [], updatedAt: '2026-10-03T08:00:00Z', revision: 'r1' };
  const cache = createProductionPlanCache({ now: () => now, read: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  const first = cache(); await Promise.resolve();
  now = 60000;
  const other = Array.from({ length: 100 }, () => cache());
  release(plan);
  await Promise.all([first, ...other]);
  assert.equal(calls, 1);
  now += 29000;
  assert.equal(await cache(), plan);
  assert.equal(calls, 1);
});

test('failed reads keep previous data and genuine timestamp with a retry cooldown', async () => {
  let now = 0, calls = 0, fail = false;
  const plan = { items: [{ id: 7 }], updatedAt: '2026-10-03T08:00:00Z', revision: 'r1' };
  const cache = createProductionPlanCache({ now: () => now, read: async previous => { calls++; if (fail) throw new Error('offline'); return { ...(previous || plan), stale: false }; } });
  await cache(); now = 31000; fail = true;
  const stale = await cache();
  assert.deepEqual(stale.items, plan.items);
  assert.equal(stale.updatedAt, plan.updatedAt);
  assert.equal(stale.stale, true);
  for (let i = 0; i < 100; i++) await cache();
  assert.equal(calls, 2);
  now += 31000; fail = false;
  assert.equal((await cache()).stale, false);
  assert.equal(calls, 3);
});

test('initial failures back off; authentication failures discard cached data', async () => {
  let now = 0, calls = 0, status = 500;
  const cache = createProductionPlanCache({ now: () => now, read: async () => { calls++; if (status) throw Object.assign(new Error('denied'), { status }); return { items: [{ id: 1 }] }; } });
  await assert.rejects(cache()); await assert.rejects(cache()); assert.equal(calls, 1);
  now = 31000; status = 0; await cache();
  now += 31000; status = 403; await assert.rejects(cache(), { status: 403 });
  await assert.rejects(cache(), { status: 403 }); assert.equal(calls, 3);
});

test('revision-only MES response reuses rows and preserves actual update time', async () => {
  const previous = { items: [{ id: 7 }], revision: 'r1', updatedAt: '2026-10-03T08:00:00Z', stale: true };
  const result = await readActiveProductionPlan(async (op, input) => {
    assert.equal(op, 'state'); assert.deepEqual(input, { revision: 'r1' });
    return { notModified: true, revision: 'r1', updatedAt: previous.updatedAt };
  }, undefined, previous);
  assert.equal(result.items, previous.items);
  assert.equal(result.updatedAt, previous.updatedAt);
  assert.equal(result.stale, false);
});

test('conditional output still checks permissions and never hides a stale warning', async () => {
  const req = { method: 'GET', query: { from: '2026-10-01', to: '2026-10-31' } };
  let permissions = 0, stale = false;
  const deps = { admin: {}, authorize: async () => { permissions++; return ['Production']; }, readPlan: async () => ({ items: [], source: 'piano-attivo', updatedAt: '2026-10-03T08:00:00Z', stale }) };
  const first = await productionCalendarRequest(req, deps);
  req.query.revision = first.revision;
  assert.deepEqual(await productionCalendarRequest(req, deps), { notModified: true });
  assert.equal(permissions, 2);
  stale = true;
  assert.equal((await productionCalendarRequest(req, deps)).stale, true);
  await assert.rejects(productionCalendarRequest(req, { ...deps, authorize: async () => { throw Object.assign(new Error('denied'), { status: 403 }); } }), { status: 403 });
});

test('UI transient errors preserve last valid calendar; auth errors remove it', () => {
  const previous = { valid: true, items: [{ id: 7 }], enabled: true, updatedAt: '2026-10-03T08:00:00Z' };
  const retained = calendarFailure(previous, new Error('timeout'));
  assert.equal(retained.items, previous.items);
  assert.equal(retained.updatedAt, previous.updatedAt);
  assert.match(retained.warning, /ultimo calendario valido/);
  assert.deepEqual(calendarFailure(previous, { status: 401, message: 'login' }).items, []);
  assert.deepEqual(calendarFailure(previous, { status: 403, message: 'denied' }).items, []);
  assert.equal(calendarUpdatedLabel('invalid'), '');
  assert.match(calendarUpdatedLabel(previous.updatedAt), /10:00:00/);
});

test('successful unchanged response clears the outage warning without changing the timestamp', () => {
  const previous = { valid: true, items: [{ id: 7 }], enabled: true, updatedAt: '2026-10-03T08:00:00Z', serverWarning: 'Conflitto da ripianificare' };
  const recovered = calendarNotModified(calendarFailure(previous, new Error('offline')));
  assert.equal(recovered.stale, false);
  assert.equal(recovered.updatedAt, previous.updatedAt);
  assert.equal(recovered.items, previous.items);
  assert.equal(recovered.warning, previous.serverWarning);
});

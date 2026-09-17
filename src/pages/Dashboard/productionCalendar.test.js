import test from 'node:test';
import assert from 'node:assert/strict';
import { productionActivities, activityOnDay, plantTime } from './productionCalendar.js';

test('orari di stabilimento e conversione UTC con ora legale', () => {
  assert.equal(plantTime('2026-09-17T08:00:00'), '2026-09-17T08:00');
  assert.equal(plantTime('2026-09-17T06:00:00Z'), '2026-09-17T08:00');
  assert.equal(plantTime('2026-01-17T07:00:00Z'), '2026-01-17T08:00');
});
test('lavorazioni su più giorni, fine a mezzanotte esclusiva e tipi separati dai task', () => {
  const [activity] = productionActivities([{ productionOrderId: 1, operationType: 'Packaging', start: '2026-09-17T08:00:00', end: '2026-09-19T00:00:00' }]);
  assert.equal(activity.tipo, 'production');
  assert.equal(activityOnDay(activity, '2026-09-17'), true);
  assert.equal(activityOnDay(activity, '2026-09-18'), true);
  assert.equal(activityOnDay(activity, '2026-09-19'), false);
  assert.equal(activityOnDay({ tipo: 'task', deadline: '2026-09-18' }, '2026-09-18'), true);
});

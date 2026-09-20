import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarIntervals, calendarProjection } from './production-calendar-intervals.js';
import { productionActivities, activityOnDay } from '../src/pages/Dashboard/productionCalendar.js';
import { activePlanRows } from './hr-active-production-plan.js';
const calendar = { versions: [{ effectiveFrom: '2000-01-01', week: Object.fromEntries([1,2,3,4,5,6,7].map(d => [d, d < 6 ? [['08:00','16:00']] : []])) }], exceptions: [], closures: [] };
const row = { operationType: 'Production', start: '2026-09-18T12:00:00', end: '2026-09-21T12:00:00' };
test('Friday-to-Monday work is absent on closed weekend days but retains full activity details', () => {
  const workingIntervals = calendarIntervals(row, calendar, '2026-09-18', '2026-09-21');
  const [activity] = productionActivities([{ ...row, workingIntervals }]);
  assert.equal(workingIntervals.length, 2);
  for (const [day, expected] of [['18',true],['19',false],['20',false],['21',true]]) assert.equal(activityOnDay(activity, `2026-09-${day}`),expected);
  assert.equal(activity.start, '2026-09-18T12:00'); assert.equal(activity.end, '2026-09-21T12:00');
});
test('Saturday openings are visible; holidays, closures and out-of-shift time are excluded', () => {
  const custom = { ...calendar, exceptions: [{ day: '2026-09-19', intervals: [['09:00','12:00']] }], closures: [{ from: '2026-09-21', to: '2026-09-21' }] };
  const intervals = calendarIntervals(row, custom, '2026-09-18', '2026-09-21');
  assert.deepEqual(intervals.map(i=>i.start.slice(0,10)), ['2026-09-18','2026-09-19']);
  assert.deepEqual(calendarIntervals({ ...row, start: '2026-09-18T19:00', end: '2026-09-18T20:00' }, calendar, '2026-09-18', '2026-09-18'), []);
});
test('confirmed weekend slots respect current openings and report conflicts without changing the plan', () => {
  const task = { orderId: 1, type: 0, status: 0, start: row.start, end: row.end,
    calendarIntervalsJson: JSON.stringify([{ Start: '2026-09-19T10:00:00', End: '2026-09-19T11:00:00' }]) };
  const [planned] = activePlanRows({}, { snapshot: { tasks: [task] } });
  assert.deepEqual(calendarProjection(planned, calendar, '2026-09-18', '2026-09-21'), { intervals: [], conflict: true });
  const opened = { ...calendar, exceptions: [{ day: '2026-09-19', intervals: [['09:00', '12:00']] }] };
  assert.deepEqual(calendarProjection(planned, opened, '2026-09-18', '2026-09-21'), { intervals: [{ start: '2026-09-19T10:00', end: '2026-09-19T11:00' }], conflict: false });
  const [running] = activePlanRows({}, { snapshot: { tasks: [{ ...task, status: 1 }] } });
  assert.equal(running.confirmedIntervals, undefined);
  assert.equal(calendarIntervals(running, calendar, '2026-09-18', '2026-09-21').length, 2);
});

test('a changed split shift clips confirmed work and reports the lost slot', () => {
  const planned = { ...row, confirmedIntervals: [{ start: row.start, end: '2026-09-18T16:00' }] };
  const split = { ...calendar, exceptions: [{ day: '2026-09-18', intervals: [['08:00','13:00'],['14:00','16:00']] }] };
  assert.deepEqual(calendarProjection(planned, split, '2026-09-18', '2026-09-21'), {
    intervals: [{ start: '2026-09-18T12:00', end: '2026-09-18T13:00' }, { start: '2026-09-18T14:00', end: '2026-09-18T16:00' }], conflict: true,
  });
});

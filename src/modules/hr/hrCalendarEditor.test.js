import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarSavePayload, calendarWeek, missingScheduleCount, validateSlots } from './hrCalendarEditor.js';
const calendar = { versions: [{ effectiveFrom: '1900-01-01', week: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i + 1), i < 5 ? [['07:30', '16:30']] : []])) }] };
test('daily edits use exceptions and a recurring change preserves the other weekdays', () => {
  const draft = { day: '2026-09-17', open: true, slots: [['09:00', '12:00'], ['13:00', '17:00']], scope: 'day', note: '' };
  const daily = calendarSavePayload(calendar, draft);
  assert.equal(daily.p_action, 'exception'); assert.ok(daily.p_data.reason);
  const recurring = calendarSavePayload(calendar, { ...draft, scope: 'recurring' });
  assert.deepEqual(recurring.p_data.week['4'], draft.slots);
  assert.deepEqual(recurring.p_data.week['1'], [['07:30', '16:30']]);
  assert.deepEqual(calendarWeek(calendar, draft.day)['4'], [['07:30', '16:30']]);
  assert.deepEqual(calendarSavePayload(calendar, { ...draft, open: false }).p_data.intervals, []);
});
test('invalid intervals and duplicate effective dates are rejected before writing', () => {
  assert.throws(() => validateSlots([['09:00', '13:00'], ['12:00', '15:00']]));
  assert.throws(() => validateSlots([['17:00', '09:00']]));
  assert.throws(() => calendarSavePayload(calendar, { day: '1900-01-01', open: true, slots: [['09:00', '17:00']], scope: 'recurring', note: '' }));
});
test('incomplete configuration is distinct from rest days, future contracts and explicit shifts', () => {
  const data = { employees: ['a', 'b', 'c', 'd'].map(user_id => ({ user_id, active: true })), shifts: [{ user_id: 'd', work_date: '2026-09-17' }], contracts: [
    { user_id: 'a', effective_from: '2020-01-01', site_id: 'site', start_time: '08:00', end_time: '16:00', break_minutes: 0, weekdays: [1] },
    { user_id: 'b', effective_from: '2026-10-01', site_id: 'site', start_time: '08:00', end_time: '16:00', break_minutes: 0, weekdays: [1] },
    { user_id: 'c', effective_from: '2020-01-01', start_time: null },
  ] };
  assert.equal(missingScheduleCount(data, '2026-09-17'), 2);
});

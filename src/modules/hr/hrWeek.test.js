import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedMonthSnapshot, mondayOf, shiftDate, agreementMinutes, formatMinutes, minutesBetween } from './hrWeek.js';

test('adjacent week data never replaces selected monthly attendance/export data', () => {
  const snapshots = [{ attendance: ['August'] }, { attendance: ['September'] }, { attendance: ['October'] }];
  assert.equal(selectedMonthSnapshot(['2026-08', '2026-09', '2026-10'], snapshots, '2026-09'), snapshots[1]);
  assert.throws(() => selectedMonthSnapshot([], snapshots, '2026-09'), /non disponibili/);
});
test('week navigation spans months and daylight-saving changes without shifting dates', () => {
  assert.equal(mondayOf('2026-10-01'), '2026-09-28');
  assert.equal(shiftDate('2026-09-28', 6), '2026-10-04');
  assert.equal(shiftDate('2026-10-25', 1), '2026-10-26');
});
test('agreements support numeric schedules but never turn alphanumeric or missing hours into NaN', () => {
  assert.equal(agreementMinutes({ weekdays: [1,2,3,4,5], start_time: '08:00', end_time: '16:30', break_minutes: 30 }, '2026-09-24'), 480);
  assert.equal(agreementMinutes({ agreement_fields: { weekdays: '1,2,3,4,5', weekly_hours: '40' } }, '2026-09-24'), 480);
  assert.equal(agreementMinutes({ agreement_fields: { weekdays: '1,2,3,4,5', weekly_hours: 'CCNL', start_time: 'variabile', end_time: '' } }, '2026-09-24'), null);
  assert.equal(agreementMinutes(null, '2026-09-24'), null);
  assert.equal(minutesBetween('2026-09-24T08:00:00Z', null), null);
  assert.equal(formatMinutes(NaN), 'Non determinabile');
  assert.equal(formatMinutes(-30), '−0h 30m');
});

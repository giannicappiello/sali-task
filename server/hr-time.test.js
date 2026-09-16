import test from 'node:test';
import assert from 'node:assert/strict';
import { romeInstant, monthDays, attendanceAnomaly } from '../src/modules/hr/hrTime.js';
test('HR wall-clock inputs use Rome time regardless of device timezone', () => {
  assert.equal(romeInstant('2026-09-16T08:00'), '2026-09-16T06:00:00.000Z');
  assert.equal(romeInstant('2026-12-16T08:00'), '2026-12-16T07:00:00.000Z');
  assert.throws(() => romeInstant('2026-03-29T02:30'), /inesistente/);
  assert.equal(monthDays('2028-02').length, 29);
});
test('missing checkout is an anomaly, never an inferred automatic exit', () => {
  const row = { user_id: 'a', checkin_at: '2026-09-16T06:00:00Z', checkout_at: null };
  const shifts = [{ user_id: 'a', work_date: '2026-09-16', ends_at: '2026-09-16T15:00:00Z' }];
  assert.equal(attendanceAnomaly(row, shifts, Date.parse('2026-09-16T15:15:00Z')), false);
  assert.equal(attendanceAnomaly(row, shifts, Date.parse('2026-09-16T16:00:00Z')), true);
  assert.equal(row.checkout_at, null);
});

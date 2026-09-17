import test from 'node:test';
import assert from 'node:assert/strict';
import { plannedPresentCount } from './hrCalendarPresence.js';

const interval = (user_id, from, to) => ({ user_id, starts_at: `2026-09-17T${from}:00+02:00`, ends_at: `2026-09-17T${to}:00+02:00` });
test('counts each scheduled employee once and excludes full-shift absences', () => {
  const shifts = [interval('a', '08:00', '12:00'), interval('a', '13:00', '17:00'), interval('b', '08:00', '17:00')];
  assert.equal(plannedPresentCount(shifts, []), 2);
  assert.equal(plannedPresentCount(shifts, [interval('b', '00:00', '23:59')]), 1);
  assert.equal(plannedPresentCount([], []), 0);
});
test('partial permissions leave a person available; combined absences can cover the whole shift', () => {
  const shifts = [interval('a', '08:00', '17:00')];
  assert.equal(plannedPresentCount(shifts, [interval('a', '08:00', '10:00')]), 1);
  assert.equal(plannedPresentCount(shifts, [interval('a', '08:00', '12:00'), interval('a', '11:00', '17:00')]), 0);
  assert.equal(plannedPresentCount(shifts, [interval('a', '17:00', '18:00')]), 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarUpdatedLabel } from './productionCalendarState.js';

test('calendar refresh timestamp shows full Italian date and Rome time', () => {
  assert.equal(calendarUpdatedLabel('2026-10-03T14:46:31Z'), '03-10-2026, 16:46:31');
  assert.equal(calendarUpdatedLabel('invalid'), '');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { displayDate } from './displayDate.js';
test('Italian date display preserves planning days and uses Rome for UTC timestamps', () => {
  assert.equal(displayDate('2026-09-17T14:06', true), '17-09-2026 14:06');
  assert.equal(displayDate('2026-09-17'), '17-09-2026');
  assert.equal(displayDate('2026-09-17T23:30:00Z', true), '18-09-2026 01:30');
  assert.equal(displayDate(null), '—');
  assert.equal(displayDate('invalid'), '—');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { overtimeSummary } from '../src/modules/hr/hrOvertimeSummary.js';

const contract = { user_id: 'e', effective_from: '2026-01-01', overtime_rate: 10, overtime_percent: 25, overtime_mode: null, overtime_separate: false };
const request = (day, extra = {}) => ({ id: day, user_id: 'e', kind: 'overtime', status: 'approved', starts_at: `${day}T08:00:00Z`, ends_at: `${day}T14:00:00Z`, ...extra });
const fixture = () => ({ employees: [{ user_id: 'e', name: 'Nicoletta' }], contracts: [contract], requests: [request('2026-09-10'), request('2026-09-11')] });

test('one employee row sums approved hours and values ordinary overtime with base plus percentage', () => {
  const data = fixture();
  data.requests.push(request('2026-09-12', { status: 'pending' }), request('2026-09-13', { kind: 'leave' }), data.requests[0]);
  const rows = overtimeSummary(data, '2026-09');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hours, 12);
  assert.equal(rows[0].amount, 150);
  assert.equal(rows[0].management, 'Ordinaria');
  data.contracts = [{ ...contract, overtime_separate: true }];
  assert.equal(overtimeSummary(data, '2026-09')[0].amount, 150);
});

test('month boundaries and effective agreements split an overnight request without charging other months', () => {
  const data = fixture();
  data.requests = [request('2026-08-31', { starts_at: '2026-08-31T20:00:00Z', ends_at: '2026-09-01T02:00:00Z' }),
    request('2026-09-30', { starts_at: '2026-09-30T20:00:00Z', ends_at: '2026-10-01T02:00:00Z' })];
  data.contracts = [{ ...contract, effective_from: '2026-09-30', overtime_rate: 20, overtime_separate: true }, contract];
  const row = overtimeSummary(data, '2026-09')[0];
  assert.equal(row.hours, 6); // Four September hours at the start + two at the end.
  assert.equal(row.amount, 100);
  assert.equal(row.management, 'Ordinaria / Separata');
});

test('missing or descriptive prices never become zero or a misleading partial total', () => {
  const data = fixture();
  data.contracts.push({ ...contract, effective_from: '2026-09-11', overtime_rate: null });
  assert.equal(overtimeSummary(data, '2026-09')[0].amount, null);
  data.contracts = [{ ...contract, overtime_percent: 'da concordare' }];
  assert.equal(overtimeSummary(data, '2026-09')[0].amount, null);
  data.contracts = [{ ...contract, overtime_percent: 0, overtime_rate: 0 }];
  assert.equal(overtimeSummary(data, '2026-09')[0].amount, 0);
});

test('employees stay distinct by id and alphabetical, preserving source data', () => {
  const data = fixture();
  data.employees.push({ user_id: 'a', name: 'Anna' });
  data.contracts.push({ ...contract, user_id: 'a' });
  data.requests.push(request('2026-09-15', { user_id: 'a' }));
  assert.deepEqual(overtimeSummary(data, '2026-09').map(r => [r.name, r.hours]), [['Anna', 6], ['Nicoletta', 12]]);
  assert.equal(data.employees[0].name, 'Nicoletta');
});

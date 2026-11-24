import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyAttendance, eventsForDay, eventDraft, calendarRequestPayload } from './hrMonthlyGrid.js';
import { monthDays, romeInstant } from './hrTime.js';

const now = new Date('2026-11-24T12:00:00Z');
const request = (kind, from, to, user = 'a', status = 'approved') => ({ id: `${kind}:${from}:${user}`, user_id: user, kind, starts_at: romeInstant(from), ends_at: romeInstant(to), note: 'Prova', status });
function fixture() {
  const employees = [{ user_id: 'a', name: 'Anna', active: true }, { user_id: 'b', name: 'Bruno', active: true }];
  const shifts = employees.flatMap(employee => monthDays('2026-11').filter(day => { const d = new Date(`${day}T12:00:00Z`).getUTCDay(); return d > 0 && d < 6; }).map(day => ({ id: `${employee.user_id}:${day}`, user_id: employee.user_id, work_date: day, starts_at: romeInstant(`${day}T08:00`), ends_at: romeInstant(`${day}T17:00`), break_minutes: 60 })));
  return { employees, shifts, attendance: [], contracts: employees.map(e => ({ user_id: e.user_id, effective_from: '2026-01-01', weekdays: [1, 2, 3, 4, 5], overtime_separate: e.user_id === 'b' })), closures: [], requests: [request('permission', '2026-11-24T09:00', '2026-11-24T10:00'), request('overtime', '2026-11-24T17:00', '2026-11-24T19:00'), request('leave', '2026-11-25T00:00', '2026-11-27T00:00'), request('permission', '2026-11-24T14:00', '2026-11-24T15:00', 'a', 'pending'), request('overtime', '2026-11-25T17:00', '2026-11-25T18:30', 'b')], attendance_policy: { mode: 'default_present', effective_from: '2026-11-01' } };
}
test('monthly matrix preserves schedule presence with partial permission and overtime in the same cell', () => {
  const data = fixture(), grid = monthlyAttendance(data, '2026-11', now), row = grid.rows[0], cell = row.cells.find(c => c.day === '2026-11-24');
  assert.equal(grid.days.length, 30);
  assert.deepEqual(cell.codes, ['PR', 'P', 'STR 2h']);
  assert.equal(cell.pending, true); assert.equal(cell.detail['Ore presenza rilevata'], 7);
  assert.equal(row.total.present, 17); assert.equal(row.total.permission, 1); assert.equal(row.total.weekdayOvertime, 2);
});
test('future days stay planned without false missing exits; separate overtime and future absences remain visible', () => {
  const grid = monthlyAttendance(fixture(), '2026-11', now);
  const future = grid.rows[0].cells.find(c => c.day === '2026-11-25');
  assert.equal(future.future, true); assert.equal(future.unknown, false); assert.deepEqual(future.codes, ['F']);
  assert.equal(grid.rows[0].total.leave, 2);
  assert.equal(grid.rows[1].total.weekdayOvertime, 0); assert.equal(grid.rows[1].total.separateOvertime, 1.5);
  assert.deepEqual(grid.rows[1].cells.find(c => c.day === '2026-11-25').codes, ['STR 1,5h S']);
});
test('holidays and weekends stay distinct and pending/rejected events do not alter approved totals', () => {
  const data = fixture(); data.requests.push(request('overtime', '2026-11-01T08:00', '2026-11-01T10:00'), request('overtime', '2026-11-24T19:00', '2026-11-24T21:00', 'a', 'rejected'));
  const row = monthlyAttendance(data, '2026-11', now).rows[0];
  assert.equal(row.cells[0].holiday, 'Ognissanti'); assert.equal(row.total.festiveOvertime, 2); assert.equal(row.total.weekdayOvertime, 2);
  assert.equal(row.cells.find(c => c.day === '2026-11-07').saturday, true);
});
test('missing schedules and historic open punches remain distinguishable from future planned days', () => {
  const data = fixture(); data.shifts = []; data.contracts = [];
  assert.deepEqual(monthlyAttendance(data, '2026-11', now).rows[0].cells.find(c => c.day === '2026-11-23').codes, ['Orario?']);
  data.attendance_policy = null; data.attendance = [{ user_id: 'a', checkin_at: romeInstant('2026-11-23T08:00'), checkout_at: null }];
  const row = monthlyAttendance(data, '2026-11', now).rows[0];
  assert.equal(row.cells.find(c => c.day === '2026-11-23').unknown, true);
  assert.equal(row.cells.find(c => c.day === '2026-11-25').unknown, false);
});
test('Rome civil day intersection uses an exclusive end and excludes unrelated/rejected events', () => {
  const requests = [request('leave', '2026-10-24T00:00', '2026-10-25T00:00'), request('permission', '2026-10-25T02:00', '2026-10-25T04:00', 'b')];
  assert.equal(eventsForDay(requests, 'a', '2026-10-24').length, 1);
  assert.equal(eventsForDay(requests, 'a', '2026-10-25').length, 0);
  assert.equal(eventsForDay(requests, 'b', '2026-10-25').length, 1);
});
test('cell drafts use the employee shift; decimal hours, range edits and validation create the RPC contract', () => {
  const data = fixture(), draft = eventDraft(data, 'a', '2026-11-24');
  assert.equal(draft.starts_at, '2026-11-24T17:00');
  const payload = calendarRequestPayload('a', { ...draft, hours: '1,5', note: 'Urgenza' }, null, 'key');
  assert.equal(Date.parse(payload.ends_at) - Date.parse(payload.starts_at), 90 * 60000); assert.equal(payload.request_key, 'key');
  const existing = data.requests[0], edit = { ...eventDraft(data, 'a', '2026-11-24', 'permission'), starts_at: '2026-11-24T10:00', ends_at: '2026-11-24T11:00', note: 'Modifica' };
  const changed = calendarRequestPayload('a', edit, existing, 'update');
  assert.equal(changed.id, existing.id); assert.equal(changed.expected.status, 'approved');
  for (const hours of ['', '0', '17', 'abc']) assert.throws(() => calendarRequestPayload('a', { ...draft, hours, note: 'Prova' }, null, 'key'));
  assert.throws(() => calendarRequestPayload('a', { ...draft, note: '' }, null, 'key'), /motivazione/);
});

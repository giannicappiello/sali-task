import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesActivitySearch } from './activitySearch.js';
import { activePlanRows } from '../../../server/hr-active-production-plan.js';
import { calendarRows } from '../../../server/hr-production-calendar.js';
import { productionActivities } from './productionCalendar.js';

test('references survive the authorized calendar response and are searchable', () => {
  const rows = activePlanRows({ demands: [{ productionOrderId: 7, number: 'RDP51', octReference: 'OCT/2026/42', customer: 'Cosmètici Rossi' }] }, {
    snapshot: { resources: [{ id: 2, code: 'ST7', description: 'Station 7' }], tasks: [{ orderId: 7, orderNumber: 'OP7', articleCode: 'FP123', description: 'Crema viso', resourceId: 2, type: 0, start: '2026-09-21T08:00:00', end: '2026-09-21T16:00:00', operatoriIds: [99] }] },
  });
  const [item] = productionActivities(calendarRows(rows, ['Production'], '2026-09-01', '2026-09-30'));
  for (const query of ['ST7', 'station 7', 'station7', 'RDP 51', 'oct202642', 'FP123', 'crema viso', 'cosmetici rossi', 'Rossi ST7']) assert.equal(matchesActivitySearch(item, query), true, query);
  assert.equal(matchesActivitySearch(item, 'cliente inesistente'), false);
  assert.equal('operatoriIds' in rows[0], false);
  assert.equal(calendarRows(rows, ['Packaging'], '2026-09-01', '2026-09-30').length, 0);
});
test('Filling aliases, task metadata and empty searches', () => {
  for (const query of ['F02', 'F2', 'Filling 2', 'filling2']) assert.equal(matchesActivitySearch({ resourceCode: 'F02' }, query), true);
  assert.equal(matchesActivitySearch({ tipo: 'task', titolo: 'Verifica' }, 'cliente prodotto', ['Cliente Uno', 'Prodotto Due']), true);
  assert.equal(matchesActivitySearch({}, '  '), true);
});

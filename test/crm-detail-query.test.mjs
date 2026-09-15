import test from 'node:test';
import assert from 'node:assert/strict';
import { queryDetailRows } from '../src/modules/crm/crmDetailQuery.js';

const columns = [{ key: 'name', value: r => r.name }, { key: 'amount', value: r => `${r.amount} €`, sortValue: r => r.amount }, { key: 'date', value: r => r.date }];
const rows = [{ name: 'Armonia', amount: 100, date: '2026-09-10' }, { name: 'Bellezza', amount: 9, date: '2026-09-11' }, { name: 'Armonia Nord', amount: 20, date: '2026-08-10' }];
test('global and column filters combine without mutating the source', () => {
  const result = queryDetailRows(rows, columns, 'ARMONIA', { date: '2026-09' }, { key: '', direction: 'asc' });
  assert.deepEqual(result, [rows[0]]); assert.equal(rows.length, 3);
});
test('money sorts numerically in both directions instead of formatted text', () => {
  assert.deepEqual(queryDetailRows(rows, columns, '', {}, { key: 'amount', direction: 'asc' }).map(r => r.amount), [9,20,100]);
  assert.deepEqual(queryDetailRows(rows, columns, '', {}, { key: 'amount', direction: 'desc' }).map(r => r.amount), [100,20,9]);
  assert.equal(rows[0].amount, 100);
});
test('no matches and reset preserve full data and deterministic date ordering', () => {
  assert.equal(queryDetailRows(rows, columns, 'missing', {}, {}).length, 0);
  assert.deepEqual(queryDetailRows(rows, columns, '', {}, { key: 'date', direction: 'desc' }).map(r => r.name), ['Bellezza','Armonia','Armonia Nord']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { displayDate } from '../src/lib/displayDate.js';
import { filterDashboardOrders } from '../src/modules/orders/services/dashboardOrders.js';
test('le date ordine mantengono il giorno e i timestamp usano gg-mm-aaaa e ora italiana',()=>{
 assert.equal(displayDate('2026-10-31'),'31-10-2026');
 assert.equal(displayDate('2026-10-31T23:30:00Z',true),'01-11-2026 00:30');
 assert.equal(displayDate('2026-10-31T23:30:00',true),'31-10-2026 23:30');
 assert.equal(displayDate(null),'—');
});
test('la ricerca trova la stessa data visualizzata nell’elenco',()=>{
 const orders=[{id:'a',data_ordine:'2026-10-31',stato:'aperto'},{id:'b',data_ordine:'2026-10-30',stato:'evaso'}];
 assert.deepEqual(filterDashboardOrders(orders,'31-10-2026').map(o=>o.id),['a']);
 assert.deepEqual(filterDashboardOrders(orders,'31-10-2026','','2026-10').map(o=>o.id),['a']);
});

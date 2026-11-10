import test from 'node:test';
import assert from 'node:assert/strict';
import { businessWindow, reconcileStock, reconcileMovements, evaluatePlanning } from './engine.js';
const coverage = Object.fromEntries(['planning', 'bom', 'stock', 'requirements', 'purchaseOrders', 'receipts', 'quality', 'capacity', 'movements'].map(x => [x, { complete: true }]));
const now = new Date('2026-11-10T06:00:00Z');
const baseStock = { warehouse: '1', article: 'MP1', unit: 'KG', lot: null, basis: 'physical', onHand: 10, capturedAt: '2026-11-10T05:59:00Z', syncedThrough: '2026-11-10T05:59:00Z', complete: true, reservedOutsideHorizon: 0, qualityReleased: true };
test('07:00 Rome follows summer and winter time and calendar bounds', () => {
 assert.equal(businessWindow(now).due, true);
 assert.equal(businessWindow(new Date('2026-07-10T05:00:00Z')).due, true);
 assert.equal(businessWindow(new Date('2026-07-10T06:00:00Z')).due, false);
 assert.deepEqual(businessWindow(now), { from: '2026-11-10', toExclusive: '2026-12-08', yesterday: '2026-11-09', due: true });
 assert.equal(businessWindow(new Date('2026-03-28T06:00:00Z')).toExclusive, '2026-04-25');
});
test('availability and accounting differences never become physical stock errors', () => {
 const rows = ['mexal', 'mes', 'workspace'].map(source => ({ ...baseStock, source, available: source === 'mexal' ? 10 : 3, committed: 7 }));
 assert.equal(reconcileStock(rows)[0].classification, 'aligned');
 rows[1].onHand = 8;
 assert.equal(reconcileStock(rows)[0].classification, 'physical_difference_to_investigate');
 rows[1].syncedThrough = '2026-11-10T04:00:00Z';
 assert.equal(reconcileStock(rows)[0].classification, 'sync_pending');
 delete rows[1].lot;
 assert(reconcileStock(rows).every(x => x.classification === 'not_comparable'));
});
test('UM, warehouses, lots, incomplete or duplicate sources are never silently merged', () => {
 const rows = ['mexal', 'mes', 'workspace'].map(source => ({ ...baseStock, source }));
 rows[1].unit = 'G'; assert(reconcileStock(rows).every(x => x.classification === 'not_comparable'));
 rows[1].unit = 'KG'; rows[1].lot = 'B'; assert(reconcileStock(rows).every(x => x.classification === 'not_comparable'));
 assert.equal(reconcileStock([rows[0], rows[0], rows[2]])[0].classification, 'not_comparable');
});
test('movement reconciliation preserves signs, dimensions, timestamps and sync lag', () => {
 const rows = ['mexal','mes','workspace'].map(source => ({ ...baseStock, source, canonicalEventId: 'SL:1:123:1', signedQuantity: -3, eventAt: '2026-11-10T05:00:00Z' }));
 assert.equal(reconcileMovements(rows)[0].classification,'aligned');
 rows[1].signedQuantity = 3; assert.equal(reconcileMovements(rows)[0].classification,'physical_difference_to_investigate');
 rows[1].syncedThrough = '2026-11-10T04:00:00Z'; assert.equal(reconcileMovements(rows)[0].classification,'sync_pending');
 delete rows[1].canonicalEventId; assert(reconcileMovements(rows).every(x => x.classification==='not_comparable'));
});
test('partial input remains incomplete and never reports all clear', () => {
 const result = evaluatePlanning({ coverage: {} }, now);
 assert.equal(result.status, 'incomplete'); assert.equal(result.gaps.length, 9); assert.equal(result.findings.length, 0);
});
const job = (id, quantity, day = '2026-11-11') => ({ id, day, status: 'planned', bomVerified: true, materials: [{ article: 'MP1', warehouse: '1', unit: 'KG', lot: null, quantity }] });
test('stock is consumed once across all planned jobs and cascades terminate on cycles', () => {
 const jobs = [job('A', 7), { ...job('B', 7), dependsOn: ['C'] }, { ...job('C', 0), materials: [], dependsOn: ['B'] }];
 const result = evaluatePlanning({ coverage, jobs, stock: [{ ...baseStock, source: 'mexal' }] }, now);
 const shortage = result.findings.find(x => x.category === 'material_shortage');
 assert.equal(shortage.evidence.jobId, 'B'); assert.equal(shortage.evidence.shortage, 4);
 assert(result.findings.some(x => x.category === 'cascade' && x.evidence.jobId === 'C'));
 assert.equal(result.findings.filter(x => x.category === 'material_shortage').length, 1);
});
test('unverified stock, quality or external reservations never imply a shortage', () => {
 for (const field of ['reservedOutsideHorizon', 'qualityReleased', 'capturedAt']) {
  const stock = { ...baseStock, source: 'mexal' }; delete stock[field];
  const result = evaluatePlanning({ coverage, jobs: [job('A', 20)], stock: [stock] }, now);
  assert.equal(result.status, 'incomplete'); assert(!result.findings.some(x => x.category === 'material_shortage'));
 }
});
test('uncovered demand and late supplier quantities are allocated once across jobs', () => {
 const result = evaluatePlanning({ coverage, jobs:[job('A',20),job('B',7)],stock:[{...baseStock,source:'mexal'}],purchaseOrders:[{...baseStock,id:'OF1',remaining:10,deliveryDay:'2026-11-30'}] },now);
 assert.deepEqual(result.findings.filter(x=>x.category==='material_shortage').map(x=>x.evidence.shortage),[10,7]);
 assert.equal(result.findings.filter(x=>x.category==='purchase_missing').length,1);
 assert.equal(result.findings.find(x=>x.category==='purchase_missing').evidence.jobId,'B');
});
test('late/missing deliveries, yesterday receipt and capacity produce stable findings', () => {
 const snapshot = { coverage, jobs: [job('A', 20)], stock: [{ ...baseStock, source: 'mexal' }], purchaseOrders: [{ ...baseStock, id: 'OF1', remaining: 4, deliveryDay: '2026-11-20' }], receipts: [{ id: 'R1', day: '2026-11-09', article: 'MP1', qualityReleased: false }], capacity: [{ resourceId: 'R', day: '2026-11-11', requiredHours: 10, availableHours: 8 }] };
 const a = evaluatePlanning(snapshot, now), b = evaluatePlanning(snapshot, now);
 for (const category of ['purchase_partial', 'delivery_incompatible', 'receipt_quality', 'capacity', 'requirement_missing']) assert(a.findings.some(x => x.category === category), category);
 assert.deepEqual(a.findings.map(x => x.fingerprint), b.findings.map(x => x.fingerprint));
 assert(!evaluatePlanning({ ...snapshot, jobs: [job('outside', 30, '2026-12-08')] }, now).findings.some(x => x.category === 'material_shortage'));
});

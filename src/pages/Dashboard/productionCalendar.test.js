import test from 'node:test';
import assert from 'node:assert/strict';
import { productionActivities, activityOnDay, activityInMonth, plantTime, stationPanelUrl } from './productionCalendar.js';

test('collegamenti impianto limitati alle Station configurate, nessun pannello Filling inventato', () => {
  assert.equal(stationPanelUrl('Production', 'ST7'), 'http://10.64.0.217');
  assert.equal(stationPanelUrl('Production', 'ST01'), 'http://10.64.0.179:1880/ui');
  assert.equal(stationPanelUrl('Packaging', 'F02'), '');
  assert.equal(stationPanelUrl('Production', 'ST999'), '');
  assert.equal(stationPanelUrl('Production', 'https://external.invalid'), '');
  const [item] = productionActivities([{ operationType: 'Production', resourceCode: 'ST7', start: '2026-09-17T08:00:00', end: '2026-09-17T16:00:00' }]);
  assert.equal(item.reparto, 'Preparazione');
  assert.equal(item.panelUrl, 'http://10.64.0.217');
});

test('orari di stabilimento e conversione UTC con ora legale', () => {
  assert.equal(plantTime('2026-09-17T08:00:00'), '2026-09-17T08:00');
  assert.equal(plantTime('2026-09-17T06:00:00Z'), '2026-09-17T08:00');
  assert.equal(plantTime('2026-01-17T07:00:00Z'), '2026-01-17T08:00');
});

test('MES monthly list includes work spanning month boundaries', () => {
  const [activity] = productionActivities([{ operationType: 'Production', start: '2026-08-31T08:00:00', end: '2026-10-01T00:00:00' }]);
  assert.equal(activityInMonth(activity, 2026, 8), true);
  assert.equal(activityInMonth(activity, 2026, 9), false);
});
test('lavorazioni su più giorni, fine a mezzanotte esclusiva e tipi separati dai task', () => {
  const [activity] = productionActivities([{ productionOrderId: 1, operationType: 'Packaging', start: '2026-09-17T08:00:00', end: '2026-09-19T00:00:00' }]);
  assert.equal(activity.tipo, 'production');
  assert.equal(activityOnDay(activity, '2026-09-17'), true);
  assert.equal(activityOnDay(activity, '2026-09-18'), true);
  assert.equal(activityOnDay(activity, '2026-09-19'), false);
  assert.equal(activityOnDay({ tipo: 'task', deadline: '2026-09-18' }, '2026-09-18'), true);
});

test('attività di confezionamento conserva ID ordine e codice articolo per foglio e capitolato', () => {
  const [activity] = productionActivities([{ productionOrderId: 16004, articleCode: 'CO0017', operationType: 'Packaging', start: '2026-09-17T14:06:00', end: '2026-09-17T15:27:00' }]);
  assert.equal(activity.productionOrderId, 16004);
  assert.equal(activity.articleCode, 'CO0017');
  assert.equal(activity.reparto, 'Confezionamento');
});

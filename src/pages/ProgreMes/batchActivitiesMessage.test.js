import test from 'node:test';
import assert from 'node:assert/strict';
import { batchActivitiesMessage } from './batchActivitiesMessage.js';
import { isProgremesFrameMessage } from './progremesWindow.js';
const activity = { productionOrderId: 46, batchNumber: 1, orderNumber: 'RDP46', articleCode: 'DC0003E',
  descrizione: 'Retinol Complex', resourceCode: 'ST4', resource: 'ST4 · STATION 4', stato: 'In lavorazione',
  start: '2026-10-02T12:15:00', end: '2026-10-06T12:16:00', actualStart: '2026-10-02T12:15:00' };
const message = types => ({ type: 'progremes-batch-activities', activities: types.map(operationType => ({ ...activity, operationType })) });
test('opens production, packaging and cartoning separately or in phase order', () => {
  for (const type of ['Production', 'Packaging', 'Cartoning']) {
    assert.equal(batchActivitiesMessage(message([type]))[0].operationType, type);
  }
  const both = batchActivitiesMessage(message(['Packaging', 'Production']));
  assert.deepEqual(both.map(a => a.operationType), ['Production', 'Packaging']);
  const all = batchActivitiesMessage(message(['Cartoning', 'Packaging', 'Production']));
  assert.deepEqual(all.map(a => a.reparto), ['Preparazione', 'Confezionamento', 'Astucciatura']);
  assert.equal(all[0].batchNumber, 1);
  assert.match(all[0].panelUrl, /station=ST4/);
});
test('rejects mixed orders, batches, duplicate phases and invalid messages', () => {
  const valid = message(['Production', 'Packaging']);
  for (const change of [{ productionOrderId: 99 }, { batchNumber: 2 }, { start: 'invalid' }, { operationType: 'Other' }]) {
    assert.equal(batchActivitiesMessage({ ...valid, activities: [valid.activities[0], { ...valid.activities[1], ...change }] }), null);
  }
  assert.equal(batchActivitiesMessage(message(['Production', 'Production'])), null);
  assert.equal(batchActivitiesMessage(message([])), null);
  const frame = {};
  const event = { data: valid, source: frame, origin: 'https://mes.example' };
  assert.equal(isProgremesFrameMessage(event, frame, event.origin), true);
  assert.equal(isProgremesFrameMessage(event, {}, event.origin), false);
  assert.equal(isProgremesFrameMessage(event, frame, 'https://other.example'), false);
});

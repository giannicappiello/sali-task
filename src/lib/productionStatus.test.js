import test from 'node:test';
import assert from 'node:assert/strict';
import { productionStatus } from './productionStatus.js';
test('all started open phases have one label, independently of planned end', () => {
  for (const state of ['Pianificata','InProduzione','RUNNING','SUSPENDED','CLOSING','Sospesa','Chiusura in corso','Controllo qualità'])
    assert.equal(productionStatus(state, '2026-10-01T08:00:00'), 'In Lavorazione');
  for (const state of ['Completata','Terminato','COMPLETED','Chiusa','Annullata'])
    assert.equal(productionStatus(state, '2026-10-01T08:00:00'), state);
  assert.equal(productionStatus('Pianificata'), 'Pianificata');
});

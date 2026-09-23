import test from 'node:test';
import assert from 'node:assert/strict';
import { progremesContextualRoute } from './progremes-sso-routes.js';
import { stationPanelUrl } from '../src/pages/Dashboard/productionCalendar.js';
test('activity station link preserves MES code through SSO', () => {
  for (const code of ['ST01', 'ST2', 'ST10']) {
    const url = new URL(stationPanelUrl('Production', code), 'https://workspace.progre.it');
    assert.equal(url.pathname, '/produzione/progremes.Produzione');
    assert.equal(progremesContextualRoute('progremes.Produzione', Object.fromEntries(url.searchParams)), `/stations/${code}`);
  }
  assert.equal(stationPanelUrl('Production', 'ST07'), 'http://10.64.0.217');
});
test('station route rejects injected URLs and other screens', () => {
  for (const station of ['', '../admin', 'ST1/../../admin', 'https://external.invalid'])
    assert.throws(() => progremesContextualRoute('progremes.Produzione', { destination:'station', station }), /Station non valida/);
  assert.equal(progremesContextualRoute('progremes.Documenti', { destination:'station', station:'ST01' }, '/documenti'), '/documenti');
});

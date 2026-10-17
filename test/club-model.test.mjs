import test from 'node:test';
import assert from 'node:assert/strict';
import { cashbackPreview, configurationForm, configurationPayload, requestActions, CLUB_PATH } from '../src/modules/crm/club/clubModel.js';
import { CRM_ROUTE_CATALOG } from '../src/modules/crm/crmRouteCatalog.js';
import { crmNavigation } from '../src/modules/crm/crmNavigation.js';

test('Club hierarchy stays inside BtoC and opens dashboard first', () => {
  const routes = CRM_ROUTE_CATALOG.filter(r => r.view === 'club');
  assert.equal(routes.length, 7);
  assert.equal(routes.find(r => r.catalogPath === CLUB_PATH).clubPage, 'dashboard');
  assert.ok(routes.every(r => r.moduleCode === 'crm_online' && r.catalogPath.startsWith('/crm/online/')));
  assert.ok(crmNavigation('online').some(([name, path]) => name === 'SalidischiaClub' && path === CLUB_PATH));
  assert.ok(!crmNavigation('b2b').some(([name]) => name === 'SalidischiaClub'));
});
test('5 percent means 5 cents per euro and transaction rounding is explicit', () => {
  assert.equal(cashbackPreview(1, 5), 0.05); assert.equal(cashbackPreview(40, 5), 2);
  assert.equal(cashbackPreview(19.99, 5), 1); assert.equal(cashbackPreview('', 5), null);
  assert.equal(cashbackPreview(-5, 5), null); assert.equal(cashbackPreview(10, 105), null);
});
test('configuration is validated, supports money-only, and does not coerce empty rate to zero', () => {
  const form = configurationForm(null);
  assert.equal(configurationPayload(form).cashback_percent, 5);
  assert.throws(() => configurationPayload({ ...form, cashback_percent: '' }));
  assert.throws(() => configurationPayload({ ...form, reimbursement_modes: [] }));
  assert.throws(() => configurationPayload({ ...form, delivery_methods: [] }));
  assert.equal(configurationPayload({ ...form, reimbursement_modes: ['money'], delivery_methods: [] }).cash_minimum, 20);
});
test('pending rows expose APPROVA RICHIESTA and completed requests have no mutable actions', () => {
  assert.equal(requestActions({ status: 'pending' })[0][1], 'APPROVA RICHIESTA');
  assert.equal(requestActions({ status: 'approved', delivery_method: 'home' })[0][0], 'shipped');
  assert.equal(requestActions({ status: 'approved', delivery_method: 'bank_transfer' })[0][0], 'completed');
  assert.deepEqual(requestActions({ status: 'completed' }), []);
  assert.deepEqual(requestActions({ status: 'cancelled' }), []);
});

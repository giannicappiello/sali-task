import test from 'node:test';
import assert from 'node:assert/strict';
import { screenAccessAllowed, screenForPath } from '../src/config/workspaceScreenAccess.js';
import { screenAreaCodes } from '../src/config/workspaceScreenAreas.js';
import { requirePermission } from './mexal/lib/auth.js';
import { readFileSync } from 'node:fs';
import * as moduleRules from '../src/config/workspaceModules.js';
import { requiresDirectModuleGrant } from '../src/config/directCrmAccess.js';

const screen = { codice: 'integrazioni.mexal', area: 'backoffice_direct', attiva: true, percorso: '/integrations/mexal' };
const base = { screen, activeUser: true, admin: false, areaAllowed: false, moduleAllowed: false };
for (const [name, overrides, expected] of [
  ['no grant', {}, false],
  ['area grant without module', { areaAllowed: true }, true],
  ['module grant without area', { moduleAllowed: true }, true],
  ['personal screen grant without area/module', { exception: { decision: 'consenti' } }, true],
  ['screen deny overrides area and module', { areaAllowed: true, moduleAllowed: true, exception: { decision: 'nega' } }, false],
  ['inactive user', { activeUser: false, areaAllowed: true }, false],
  ['inactive screen', { screen: { ...screen, attiva: false }, admin: true }, false],
  ['missing catalog entry', { screen: null, areaAllowed: true }, false],
  ['admin-only remains protected', { screen: { ...screen, metadati: { admin_only: true } }, exception: { decision: 'consenti' } }, false],
  ['admin remains authorized', { admin: true }, true],
]) test(name, () => assert.equal(screenAccessAllowed({ ...base, ...overrides }), expected));

test('one screen grant does not authorize its sibling or mutate module grants', () => {
  const modules = [];
  assert.equal(screenAccessAllowed({ ...base, areaAllowed: true }), true);
  assert.equal(screenAccessAllowed({ ...base, screen: { ...screen, area: 'other' } }), false);
  assert.deepEqual(modules, []);
});
test('resolve most specific registered route, including dynamic segments', () => {
  const agent = { ...screen, codice: 'agents', percorso: '/integrations/mexal/agenti' };
  const customer = { ...screen, codice: 'customer', percorso: '/crm/clienti/:id' };
  assert.equal(screenForPath([screen, agent], '/integrations/mexal/agenti')?.codice, 'agents');
  assert.equal(screenForPath([screen, agent], '/integrations/mexal-extra'), null);
  assert.equal(screenForPath([customer], '/crm/clienti/123')?.codice, 'customer');
});

function apiMock({ result = false, error = null, active = true } = {}) {
  const calls = [];
  const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { id: 'profile', attivo: active, ruoli: { livello_accesso: 'lettura' } } }; } };
  return { calls, auth: { getUser: async () => ({ data: { user: { id: 'auth' } } }) }, from: () => query,
    rpc: async (name, args) => { calls.push({ name, args }); return { data: result, error }; } };
}
const req = { headers: { authorization: 'Bearer test-token' } };
test('server checks screen-bound operation rather than granting the module', async () => {
  const db = apiMock({ result: true });
  assert.equal((await requirePermission(req, db, 'integrations.sync.products')).id, 'profile');
  assert.equal(db.calls[0].name, 'workspace_screen_permission_for_user');
  assert.equal(db.calls[0].args.target_user_id, 'profile');
  assert.equal(db.calls[0].args.permission_code, 'integrations.sync.products');
});
test('server rejects ungranted operation', async () => {
  await assert.rejects(requirePermission(req, apiMock(), 'integrations.sync.products'), { status: 403 });
});
test('server fails closed on permission lookup failure', async () => {
  await assert.rejects(requirePermission(req, apiMock({ error: { message: 'offline' } }), 'integrations.sync.products'), { status: 503 });
});
test('server rejects inactive user before evaluating grants', async () => {
  const db = apiMock({ result: true, active: false });
  await assert.rejects(requirePermission(req, db, 'integrations.sync.products'), { status: 403 });
  assert.equal(db.calls.length, 0);
});

// Exercise the real AuthContext decisions without a browser or a user session.
const authSource = readFileSync(new URL('../src/contexts/AuthContext.jsx', import.meta.url), 'utf8');
const authHelpers = authSource.slice(authSource.indexOf('function workspaceRoleIsAdmin'), authSource.indexOf('export function AuthProvider'));
const decisions = authSource.slice(authSource.indexOf('  function isAdmin()'), authSource.indexOf('  const adminUser = isAdmin();'));
function authDecisions(overrides = {}) {
  const state = { profile: { attivo: true, ruoli: { livello_accesso: 'scrittura' } },
    permissions: ['integrations.sync.products'], moduleAccess: [], moduleLevels: { integrazioni: 'amministrazione' },
    moduleAreas: { integrazioni: 'organizzazione' }, areaAccess: ['backoffice_direct'], accessExceptions: [],
    screenCatalog: { screens: [screen, { ...screen, codice: 'agents', area: 'private_area', percorso: '/integrations/mexal/agenti' }],
      links: [{ modulo_codice: 'integrazioni', schermata_codice: screen.codice }, { modulo_codice: 'integrazioni', schermata_codice: 'agents' }] },
    location: { pathname: '/integrations/mexal' }, dataScope: {}, ...overrides };
  const args = { ...state, ...moduleRules, screenAreaCodes, screenAccessAllowed, screenForPath, requiresDirectModuleGrant, WORKSPACE_ADMIN_ROLE_NAMES: new Set(['admin']) };
  return new Function(...Object.keys(args), `${authHelpers}\n${decisions}\nreturn { hasScreenAccess, hasModuleAccess, hasPermission, canUseScreen, getModuleScreenGrant };`)(...Object.values(args));
}
test('AuthContext allows area screen, keeps module and sibling denied, preserves assigned operation', () => {
  const auth = authDecisions();
  assert.equal(auth.hasScreenAccess(screen.codice), true);
  assert.equal(auth.hasModuleAccess('integrazioni'), false);
  assert.equal(auth.hasScreenAccess('agents'), false);
  assert.equal(auth.hasPermission('integrations.sync.products'), true);
  assert.equal(auth.hasPermission('integrations.configure'), false);
  assert.equal(auth.getModuleScreenGrant('integrazioni')?.codice, screen.codice);
});
test('screen-level read-only exception caps operations even when module is granted', () => {
  const auth = authDecisions({ moduleAccess: ['integrazioni'], areaAccess: ['organizzazione'], accessExceptions: [
    { scope: 'schermata', code: screen.codice, decision: 'consenti', level: 'lettura' },
  ] });
  assert.equal(auth.hasScreenAccess(screen.codice), true);
  assert.equal(auth.hasPermission('integrations.read'), true);
  assert.equal(auth.hasPermission('integrations.sync.products'), false);
});
test('expired screen exception does not grant access', () => {
  const auth = authDecisions({ areaAccess: [], accessExceptions: [
    { scope: 'schermata', code: screen.codice, decision: 'consenti', expires_at: '2000-01-01' },
  ] });
  assert.equal(auth.hasScreenAccess(screen.codice), false);
});
test('specific screen denial remains enforced on its exact nested route', () => {
  const auth = authDecisions({ moduleAccess: ['integrazioni'], areaAccess: ['organizzazione'], location: { pathname: '/integrations/mexal/agenti' },
    accessExceptions: [{ scope: 'schermata', code: 'agents', decision: 'nega' }] });
  assert.equal(auth.hasPermission('integrations.read'), false);
});

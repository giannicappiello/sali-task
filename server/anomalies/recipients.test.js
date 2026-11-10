import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecipients } from './recipients.js';
const policy = { departmentManager: true, workspaceAdmins: true, departmentOverrides: {}, additionalUserIds: [] };
const users = [{ id: 'a', email: 'admin@progre.it', ruoli: { amministratore_workspace: true } }, { id: 'b', email: 'admin2@progre.it', ruoli: { amministratore_workspace: true } }, { id: 'c', email: 'manager@progre.it' }, { id: 'd', email: 'member@progre.it', responsabile_utente_id: 'c' }];
test('department manager and two current admins resolved dynamically without duplicate addresses', () => {
 const result = resolveRecipients({ departmentId: 'dept', policy, users, memberships: [{ reparto_id: 'dept', utente_id: 'd' }] });
 assert.equal(result.ready, true); assert.deepEqual(result.recipients.map(x => x.userId), ['a', 'b', 'c']);
 const duplicate = resolveRecipients({ departmentId: 'dept', policy: { ...policy, additionalUserIds: ['a', 'c'] }, users, memberships: [{ reparto_id: 'dept', utente_id: 'd' }] });
 assert.equal(duplicate.recipients.length, 3);
});
test('missing/ambiguous managers require configuration, never an inferred role', () => {
 const result = resolveRecipients({ departmentId: 'dept', policy, users, memberships: [] });
 assert.equal(result.ready, false); assert.equal(result.gaps[0].code, 'DEPARTMENT_MANAGER_NOT_CONFIGURED');
 const override = resolveRecipients({ departmentId: 'dept', policy: { ...policy, departmentOverrides: { dept: 'c' } }, users, memberships: [] });
 assert.equal(override.ready, true);
});
test('inactive recipients and malformed addresses block delivery', () => {
 const result = resolveRecipients({ departmentId: 'dept', policy: { ...policy, departmentOverrides: { dept: 'c' } }, users: users.map(x => x.id === 'c' ? { ...x, attivo: false } : x), memberships: [] });
 assert.equal(result.ready, false); assert(!result.recipients.some(x => x.userId === 'c'));
});

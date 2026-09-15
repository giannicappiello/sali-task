import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canChatTogether, canSelectChatUser, chatDepartmentIds, isChatLeader } from '../src/pages/Messages/chatDirectory.js';
const user = (id, role, department, extra = []) => ({ id, attivo: true, ruoli: { nome: role }, reparto_id: department, utenti_reparti: extra.map(reparto_id => ({ reparto_id })) });
const manager = user('manager', 'Responsabile reparto', 'production');
const member = user('member', 'Operatore', 'production');
const director = user('director', 'Direzione', 'sales');
const outsider = user('outsider', 'Operatore', 'sales');
test('only leadership roles can chat across departments, in either direction', () => {
  for (const role of ['Direzione', 'Direttore commerciale', 'Direttrice', 'Responsabile reparto']) assert.equal(isChatLeader(user('x',role)),true);
  assert.equal(isChatLeader(user('x','Admin')),false);
  assert.equal(canChatTogether(manager,director),true);
  assert.equal(canChatTogether(member,director),false);
  assert.equal(canChatTogether(director,member),false);
  assert.equal(canChatTogether(manager,outsider),false);
  assert.equal(canChatTogether(member,outsider),false);
});
test('all active colleagues in a shared primary or additional department can chat', () => {
  assert.equal(canChatTogether(manager,member),true);
  const multiple=user('multi','Operatore','sales',['production','sales']);
  assert.deepEqual(chatDepartmentIds(multiple),['sales','production']);
  assert.equal(canChatTogether(member,multiple),true);
  assert.equal(canChatTogether(member,{...multiple,attivo:false}),false);
  assert.equal(canChatTogether(undefined,member),false);
  assert.equal(canChatTogether(user('a','Operatore'),user('b','Operatore')),false);
});
test('a group cannot bridge a local collaborator to a foreign director', () => {
  assert.equal(canSelectChatUser(manager,director,[]),true);
  assert.equal(canSelectChatUser(manager,member,[director]),false);
  assert.equal(canSelectChatUser(manager,director,[member]),false);
  assert.equal(canSelectChatUser(manager,manager,[]),false);
  assert.equal(canSelectChatUser(manager,user('other','Responsabile reparto','logistics'),[director]),true);
});

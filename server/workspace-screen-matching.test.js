import test from 'node:test';
import assert from 'node:assert/strict';
import { exactWorkspaceScreen } from '../src/components/workspaceScreenMatch.js';
import { moduleScreenNavigation } from '../src/config/moduleScreenNavigation.js';

const list = { codice: 'crm.online.clienti', percorso: '/crm/online/clienti', attiva: true };
const detail = { codice: 'crm.online.cliente', percorso: '/crm/online/clienti/:id', attiva: true };
const club = { codice: 'crm.online.club.premi', percorso: '/crm/online/salidischiaclub/premi', attiva: true };
test('customer details resolve to their own registered layout across different customers', () => {
  for (const key of ['crm%3A1234', 'mexal%3A501.02156', 'another-id']) assert.equal(exactWorkspaceScreen([list, detail], `/crm/online/clienti/${key}`).codice, detail.codice);
  assert.equal(exactWorkspaceScreen([list, detail], '/crm/online/clienti/'), list);
  assert.equal(exactWorkspaceScreen([list, detail], '/crm/online/clienti/a/unregistered'), undefined);
});
test('literal screens win over parameterized screens and unrelated routes do not match', () => {
  const literal = { codice: 'new', percorso: '/crm/online/clienti/nuovo' };
  assert.equal(exactWorkspaceScreen([detail,literal], literal.percorso),literal);
  assert.equal(exactWorkspaceScreen([list,detail,club], club.percorso),club);
  assert.equal(exactWorkspaceScreen([detail], '/crm/b2b/clienti/a'),undefined);
});
test('moved Club screens follow the configured module, visibility, order and screen authorization', () => {
  const modules = [{codice:'custom',nome:'Club',attivo:true,tipo:'modulo',percorso:'/moduli/custom'}];
  const links = [
    {modulo_codice:'custom',schermata_codice:club.codice,ordine:20,visibile_menu:true},
    {modulo_codice:'custom',schermata_codice:list.codice,ordine:10,predefinita:true,visibile_menu:true},
    {modulo_codice:'custom',schermata_codice:detail.codice,ordine:30,visibile_menu:false},
  ];
  const catalog = {modules,links,screens:[list,detail,club]};
  const result=moduleScreenNavigation(catalog,club.percorso,'custom',()=>true);
  assert.equal(result.module.codice,'custom');
  assert.deepEqual(result.items.map(row=>row.codice),[list.codice,club.codice]);
  assert.equal(moduleScreenNavigation(catalog,club.percorso,'custom',code=>code!==club.codice),null);
});

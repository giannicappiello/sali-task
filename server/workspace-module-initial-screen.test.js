import test from 'node:test';
import assert from 'node:assert/strict';
import { initialModuleScreen } from '../src/config/workspaceNavigation.js';
const screens = [{codice:'digital',percorso:'/crm/online/digital'},{codice:'ecommerce',percorso:'/crm/online/ecommerce'}];
test('opens the explicitly selected initial screen rather than the first card', () => {
  assert.equal(initialModuleScreen([{schermata_codice:'digital',ordine:10},{schermata_codice:'ecommerce',ordine:20,predefinita:true}],screens),screens[1]);
});
test('no initial screen leaves the module as a card container', () => {
  assert.equal(initialModuleScreen([{schermata_codice:'digital',predefinita:false}],screens),null);
});
test('hidden, inactive, inaccessible and self-referencing screens cannot redirect', () => {
  assert.equal(initialModuleScreen([{schermata_codice:'digital',predefinita:true,visibile_menu:false}],screens),null);
  assert.equal(initialModuleScreen([{schermata_codice:'unavailable',predefinita:true}],screens),null);
  assert.equal(initialModuleScreen([{schermata_codice:'digital',predefinita:true}],[]),null);
  // Container excludes its current path from available cards before resolving.
  assert.equal(initialModuleScreen([{schermata_codice:'root',predefinita:true}],screens),null);
});

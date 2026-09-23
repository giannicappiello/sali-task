import test from 'node:test';
import assert from 'node:assert/strict';
import { missingProgremesScreens } from './progremes-screen-retention.js';

const screen = { codice: 'progremes.Impostazioni', attiva: true, metadati: { catalog_source: 'progremes_catalog' } };
const link = { modulo_codice: 'impostazioni_mes', schermata_codice: screen.codice, visibile_menu: true };
const module = { codice: 'impostazioni_mes', attivo: true };

test('a reduced MES catalogue preserves a screen reassigned to an active Workspace menu', () => {
  assert.deepEqual(missingProgremesScreens([screen], [], [link], [module]), { retained: [screen.codice], removed: [] });
});
test('inactive screens are never reactivated; hidden links and disabled modules do not retain screens', () => {
  for (const [screens, links, modules] of [
    [[{ ...screen, attiva: false }], [link], [module]],
    [[screen], [{ ...link, visibile_menu: false }], [module]],
    [[screen], [link], [{ ...module, attivo: false }]],
    [[screen], [], [module]],
  ]) assert.deepEqual(missingProgremesScreens(screens, [], links, modules), { retained: [], removed: [screen.codice] });
});
test('an explicit MES status is authoritative and local restored screens remain untouched', () => {
  assert.deepEqual(missingProgremesScreens([screen], [{ ...screen, attiva: false }], [link], [module]), { retained: [], removed: [] });
  assert.deepEqual(missingProgremesScreens([{ ...screen, metadati: { catalog_source: 'workspace_restored_screen' } }], [], [], []), { retained: [], removed: [] });
});

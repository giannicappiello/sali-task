import test from 'node:test';
import assert from 'node:assert/strict';
import { removedProgremesModules } from './progremes-restored-modules.js';
const existing = ['Produzione', 'Planning', 'Retired'].map(codice => ({ codice }));
test('keeps only explicitly restored active modules when MES omits them', () => {
  const screens = [{ attiva: true, metadati: { catalog_source: 'workspace_restored_screen', external_module_code: 'Produzione' } }];
  assert.deepEqual(removedProgremesModules(existing, ['Planning'], screens), ['Retired']);
});
test('ordinary or disabled screens do not prevent catalog deactivation', () => {
  for (const screen of [
    { attiva: true, metadati: { catalog_source: 'progremes_catalog', external_module_code: 'Produzione' } },
    { attiva: false, metadati: { catalog_source: 'workspace_restored_screen', external_module_code: 'Produzione' } },
  ]) assert.deepEqual(removedProgremesModules(existing, ['Planning'], [screen]), ['Produzione', 'Retired']);
});

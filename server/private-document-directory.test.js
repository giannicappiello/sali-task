import test from 'node:test';
import assert from 'node:assert/strict';
import { articleNasDirectory } from './private-document-directory.js';
test('NAS: apre la cartella esatta del prodotto sotto Produzione, senza confondere prefissi', () => {
  const files = ['Produzione/IT00010/a.jpg', 'Produzione/CoaPROGRE/IT0001/b.pdf', 'Produzione/IT0001/foto.jpg', 'Altro/IT0001/no.pdf'].map(path => ({ path, active: true }));
  assert.equal(articleNasDirectory(files, 'it0001').directory, 'Produzione/IT0001');
  assert.equal(articleNasDirectory(files.slice(0, 2), 'IT0001').directory, 'Produzione/CoaPROGRE/IT0001');
  assert.equal(articleNasDirectory([{ path: 'DocumentiWorkspace/Produzione/IT0001/foto.jpg', active: true }], 'IT0001').directory, 'DocumentiWorkspace/Produzione/IT0001');
  assert.match(articleNasDirectory(files, 'IT9999').notice, /Nessun file indicizzato/);
  assert.equal(articleNasDirectory(files.map(f => ({ ...f, active: false })), 'IT0001').directory, 'Produzione/IT0001');
  assert.equal(articleNasDirectory([{ path: '@Recycle/Produzione/IT0001/old.jpg', active: true }], 'IT0001').directory, 'Produzione/IT0001');
});

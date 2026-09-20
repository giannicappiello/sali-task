import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { createProductSpecificationPdf } from '../src/pages/Documentation/createProductSpecificationPdf.js';

const logoBytes = new Uint8Array(await readFile(new URL('../public/progre-logo-white.png', import.meta.url)));
const article = { articleCode: 'IT0001', description: 'Detergente intimo 250ml' };
test('bulk PDF contains formula bounds and customer acceptance with Italian date, without packaging fields', async () => {
  const result = await createProductSpecificationPdf({ article: { articleCode: 'FP001', description: 'Semilavorato' }, logoBytes,
    specification: { version: 2, attachments: [], data: { specificationKind: 'bulk', formulaCode: 'FP001', formulaRevision: '1.0 / 2',
      viscosityMin: '100', viscosityMax: '200', phMin: '4,5', phMax: '5,5', density: '1,02', appearance: 'Gel limpido', color: 'Blu', fragrance: 'Menta',
      approvedBy: 'Mario Rossi', approvedAt: '2026-09-20T10:15:00Z' } } });
  const raw = new TextDecoder().decode(await result.blob.arrayBuffer());
  for (const value of ['Mario Rossi', '20-09-2026', 'Gel limpido', 'FP001', '4,5', '5,5', '100', '200', '1,02']) assert.ok(raw.includes(value), value);
  assert.ok(!raw.includes('Firma del cliente')); assert.ok(!raw.includes('________'));
  assert.ok(!raw.includes('Packaging primario')); assert.ok(!raw.includes('Pezzi per cartone'));
});
test('capitolato PDF: logo, foto, semilavorato e impaginazione di note lunghe', async () => {
  let loaded = 0;
  const result = await createProductSpecificationPdf({ article, logoBytes, photoUrl: 'catalog-photo', dirty: false,
    specification: { version: 3, attachments: [], data: { customer: 'Cliente Alfa', semiFinished: 'FP049A', notes: 'Controllare il prodotto. '.repeat(220) } },
    loadImage: async url => { assert.equal(url, 'catalog-photo'); loaded++; return { data: logoBytes, width: 775, height: 323 }; },
  });
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  const document = await PDFDocument.load(bytes);
  assert.equal(loaded, 1); assert.deepEqual(result.warnings, []);
  assert.ok(document.getPageCount() >= 3);
  assert.equal(document.getTitle(), 'Capitolato prodotto IT0001');
  assert.equal(result.fileName, 'Capitolato_IT0001_rev3.pdf');
  const raw = new TextDecoder().decode(bytes);
  assert.ok(raw.includes('FP049A')); assert.ok(raw.includes('/Subtype /Image'));
});

test('capitolato PDF: segnala foto non disponibili e allegati non ancora salvati', async () => {
  const result = await createProductSpecificationPdf({ article, logoBytes, photoUrl: 'unavailable', dirty: true,
    specification: { version: 1, data: {}, attachments: [{ section: 'product', path: 'foto.jpg', name: 'foto.jpg' }] },
    loadImage: async () => { throw new Error('Unavailable'); },
  });
  assert.equal(result.warnings.length, 2);
  assert.equal(result.fileName, 'Capitolato_IT0001_bozza.pdf');
  assert.match(result.warnings.join(' '), /Allegato non disponibile/);
});

test('capitolato PDF: include subito le immagini non salvate senza campi duplicati', async () => {
  const requests = [];
  let loaded = 0;
  const result = await createProductSpecificationPdf({ article, logoBytes, dirty: true,
    specification: { version: 0, data: { bottleCode: 'CN01', bottleDescription: 'Flacone', cartonCode: '__NONE__' }, attachments: [{ section: 'primary', path: 'Produzione/IT0001/foto.jpg', name: 'foto.jpg' }] },
    components: [{ code: 'CN01', description: 'Flacone' }],
    request: async (...args) => { requests.push(args); return { url: 'signed-photo' }; },
    loadImage: async url => { assert.equal(url, 'signed-photo'); loaded++; return { data: logoBytes, width: 775, height: 323 }; },
  });
  assert.equal(loaded, 1); assert.equal(requests.length, 1);
  assert.match(requests[0][0], /specifications\/preview/);
  assert.equal(requests[0][1].body.path, 'Produzione/IT0001/foto.jpg');
  assert.deepEqual(result.warnings, []);
  const raw = new TextDecoder().decode(await result.blob.arrayBuffer());
  assert.ok(!raw.includes('Descrizione flacone'));
  assert.ok(raw.includes('Non previsto'));
});

// The gateway may not allow browser cross-origin fetch; PDF export retries through Workspace.
test('capitolato PDF: recupera immagini NAS tramite proxy quando il browser blocca CORS', async () => {
  const calls = [];
  const result = await createProductSpecificationPdf({ article, logoBytes, dirty: true,
    specification: { version: 0, data: {}, attachments: [{ section: 'primary', path: 'foto.jpg', name: 'foto.jpg' }] },
    request: async (path) => { calls.push(path); return path.includes('content=true') ? { base64: 'AQID', nextOffset: null } : { url: 'blocked-nas' }; },
    loadImage: async url => { if (url === 'blocked-nas') throw Error('CORS'); assert.match(url, /^blob:/); return { data: logoBytes, width: 775, height: 323 }; },
  });
  assert.deepEqual(result.warnings, []);
  assert.ok(calls.some(path => path.includes('specifications/preview') && path.includes('content=true&offset=0')));
});

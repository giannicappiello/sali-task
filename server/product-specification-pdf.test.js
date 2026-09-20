import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { createProductSpecificationPdf } from '../src/pages/Documentation/createProductSpecificationPdf.js';

const logoBytes = new Uint8Array(await readFile(new URL('../public/progre-logo-white.png', import.meta.url)));
const article = { articleCode: 'IT0001', description: 'Detergente intimo 250ml' };
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
  assert.match(result.warnings.join(' '), /Salva il capitolato/);
});

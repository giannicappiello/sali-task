import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createOrderPdf, createMexalDocumentPdfFiles } from '../src/modules/orders/services/orderPdf.js';

async function assertSafePagination(bytes, count, context) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const codes = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    const lastPage = pageNumber === pdf.numPages;
    const footer = items.find(item => item.str === 'TOTALE DA PAGARE');
    assert.equal(Boolean(footer), lastPage, `${context}: footer only on final page`);
    for (const item of items.filter(item => /^ROW\d{4}$/.test(item.str))) {
      codes.push(item.str);
      // PDF coordinates start at the bottom; verify the actual generated text,
      // with a descent allowance, stays outside the footer rectangle.
      const baselineMm = (viewport.height - item.transform[5]) / (72 / 25.4);
      assert.ok(baselineMm + item.height * 0.25 / (72 / 25.4) < (lastPage ? 210 : 260), `${context}: ${item.str} at ${baselineMm} mm overlaps footer`);
    }
    let rowTop = null;
    for (const item of items) {
      if (item.str === 'VETTORE') break;
      const baselineMm = (viewport.height - item.transform[5]) / (72 / 25.4);
      if (/^ROW\d{4}$/.test(item.str)) rowTop = baselineMm - (context.startsWith('ph/') ? 2.5 : 3.1);
      if (rowTop !== null && item.str.trim()) assert.ok(baselineMm + item.height * 0.25 / (72 / 25.4) <= rowTop + 6.5, context + ': row content spills into next row: ' + item.str);
    }
    const rowCodes = items.filter(item => /^ROW\d{4}$/.test(item.str));
    for (let i = 1; i < rowCodes.length; i += 1) {
      const stepMm = (rowCodes[i - 1].transform[5] - rowCodes[i].transform[5]) / (72 / 25.4);
      assert.ok(Math.abs(stepMm - 6.5) < 0.01, context + ': compact row spacing');
    }
    for (const item of items.filter(item => /^805\d{10}$/.test(item.str))) {
      const baselineMm = (viewport.height - item.transform[5]) / (72 / 25.4);
      assert.ok(baselineMm + item.height * 0.25 / (72 / 25.4) < (lastPage ? 210 : 260), context + ': barcode overlaps footer');
    }
    if (count > 0) assert.ok(items.some(item => /^ROW\d{4}$/.test(item.str)), `${context}: empty article page`);
    assert.ok(items.some(item => item.str === `${pageNumber}/${pdf.numPages}`), `${context}: page number`);
  }
  assert.deepEqual(codes, Array.from({ length: count }, (_, i) => `ROW${String(i).padStart(4, '0')}`), `${context}: every line exactly once and in order`);
  // First page: up to 24 rows without footer; later pages: 34 without footer,
  // 26 with footer. Check that reserving the footer adds no unnecessary pages.
  let expectedPages = count <= 16 ? 1 : 2;
  while (count > 24 + (expectedPages - 2) * 34 + 26) expectedPages += 1;
  assert.equal(pdf.numPages, expectedPages, `${context}: minimum pages with reserved footer`);
}

for (const module of ['prof', 'ph']) {
  test(`PDF ${module}: pagination and footer at row boundaries, draft/OCM/OCI/OCX`, async () => {
    for (const count of [0, 1, 16, 17, 26, 39, 42, 50, 51, 84, 85]) {
      const lines = Array.from({ length: count }, (_, i) => ({
        codice_articolo: `ROW${String(i).padStart(4, '0')}`, ean: `805${String(i).padStart(10, '0')}`,
        descrizione: 'Descrizione estesa del prodotto su due righe per verificare il rispetto degli spazi',
        quantita: 1, quantita_ocm: 1, quantita_oci: 1, quantita_ocx: 1,
        prezzo_listino: 10, sconto_commerciale: "50+35+5", aliquota_iva: 22,
      }));
      for (const type of [null, 'OCM', 'OCI', 'OCX']) {
        const document = type ? { type, serie: '1', numero: '123' } : null;
        const pdf = await createOrderPdf({ modulo_ordini: module, data_ordine: '2026-11-07' }, lines, { logo: false, document, managedLetterhead: module === 'prof' });
        await assertSafePagination(pdf.output('arraybuffer'), count, `${module}/${type || 'draft'}/${count}`);
      }
    }
  });
  test(`PDF ${module}: split-document download also keeps all rows above footer`, async () => {
    const lines = Array.from({ length: 39 }, (_, i) => ({ codice_articolo: `ROW${String(i).padStart(4, '0')}`, quantita: 3, quantita_ocm: 1, quantita_oci: 1, quantita_ocx: 1, prezzo_listino: 10 }));
    const files = await createMexalDocumentPdfFiles({ modulo_ordini: module, mexal_documents: ['OCM','OCI','OCX'].map(tipo_documento => ({ tipo_documento, serie: 1, numero: 123 })) }, lines);
    assert.equal(files.length, 3);
    for (const file of files) await assertSafePagination(file.data, 39, `${module}/${file.name}`);
  });
}

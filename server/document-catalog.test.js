import test from 'node:test';
import assert from 'node:assert/strict';
import { readAllDocumentRows, loadDocumentProductCatalog } from './document-catalog.js';

test('document sync retains links beyond the Supabase row cap', async () => {
  const source = Array.from({ length: 1105 }, (_, id) => ({ id, prodotto_id: `product-${id}` }));
  const calls = [];
  const actual = await readAllDocumentRows(() => ({ range: async (from, to) => { calls.push([from, to]);return { data: source.slice(from, to + 1) }; } }));
  assert.deepEqual(calls, [[0, 499], [500, 999], [1000, 1499]]);
  assert.deepEqual(actual, source);
});
test('product SKU matching receives the complete Sali catalogue after server-side filtering', async () => {
  const source = [ ...Array.from({ length: 3893 }, (_, id) => ({ id, codice_mexal: `OTHER${id}`, attivo_mexal: true, mostra_in_app: true })), ...Array.from({ length: 1101 }, (_, id) => ({ id: id + 3893, codice_mexal: `IT${id}`, attivo_mexal: true, mostra_in_app: true })) ];
  const admin = { from(table) { assert.equal(table, 'prodotti');let rows = source;return {
    select(columns) { assert.ok(columns.includes('codice_mexal'));return this; },
    eq(field, value) { rows = rows.filter(row => row[field] === value);return this; },
    or(filter) { assert.equal(filter, 'codice_mexal.ilike.IT%,codice.ilike.IT%');rows = rows.filter(row => row.codice_mexal.startsWith('IT'));return this; },
    order(field) { assert.equal(field, 'id');return this; },
    async range(from, to) { return { data: rows.slice(from, to + 1) }; },
  }; } };
  const products = await loadDocumentProductCatalog(admin);
  assert.equal(products.length, 1101);assert.equal(products[0].codice_mexal, 'IT0');assert.equal(products.at(-1).codice_mexal, 'IT1100');
});
test('sync stops on a failed page instead of losing stored product associations', async () => {
  await assert.rejects(readAllDocumentRows(() => ({ range: async () => ({ error: Error('Unavailable') }) })), /Unavailable/);
});

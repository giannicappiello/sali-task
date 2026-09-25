import assert from 'node:assert/strict';
import { processStockArticles, stockBatchCheckpoint } from '../server/mexal/lib/stockRunState.js';
import { importMissingStockArticle } from '../server/mexal/sync-products.js';

const processed = [], errors = [];
await processStockArticles(['A', 'B', 'C'], {
  beforeArticle: async () => {},
  processArticle: async (code) => {
    if (code === 'B') throw Object.assign(new Error('Mexal timeout dopo retry'), { retryable: true });
    processed.push(code);
  },
  onError: (code, error) => errors.push({ codice: code, errore: error.message }),
});
assert.deepEqual(processed, ['A', 'C']);
assert.equal(errors.length, 1);
await assert.rejects(processStockArticles(['D'], {
  beforeArticle: () => { throw new Error('Run annullata'); },
  processArticle: () => assert.fail('Non deve elaborare dopo annullamento'),
  onError: () => assert.fail('Non deve nascondere annullamento'),
}), /Run annullata/);

const before = { processed: 0, metadata: {} };
const first = stockBatchCheckpoint(before, { processed: 3, updated: 2, failed: 1, errors,
  importedArticles: [{ codice: 'A', destinazione: 'Catalogo prodotti' }, { codice: 'A', destinazione: 'Anagrafica' }],
}, { total: 4, batchSize: 3 });
assert.equal(first.values.inserted, 1, 'Due destinazioni contano un solo articolo importato');
const second = stockBatchCheckpoint(first.values, { processed: 1, updated: 1, failed: 0 }, { total: 4, batchSize: 3 });
assert.equal(second.values.failed, 1);
assert.equal(second.values.metadata.stock_errors[0].codice, 'B');
assert.equal(second.values.metadata.stock_imported_articles.length, 2);
assert.equal(second.values.processed, 4);

const tables = new Map([['prodotti', new Map()], ['ordini_prodotti_cache', new Map()]]);
const writes = [];
const supabase = { from(table) { return { upsert(payload, options) {
  writes.push(table);
  assert.equal(options.ignoreDuplicates, true);
  const key = payload[options.onConflict];
  const rows = tables.get(table);
  const inserted = !rows.has(key);
  if (inserted) rows.set(key, payload);
  return { select: async () => ({ data: inserted ? [{ id: key }] : [], error: null }) };
} }; } };
const imported = [];
const article = { codice: 'MP-NUOVA', descrizione: 'Nuova materia prima', gest_annullato: 'N', gest_precanc: 'N', um_principale: 'KG' };
await importMissingStockArticle({ supabase, article, onImported: (entry) => imported.push(entry) });
assert.deepEqual(writes, ['prodotti', 'ordini_prodotti_cache']);
assert.equal(imported.length, 2);
assert.equal(tables.get('ordini_prodotti_cache').get('MP-NUOVA').unita_misura, 'KG');
await importMissingStockArticle({ supabase, article, onImported: (entry) => imported.push(entry) });
assert.equal(imported.length, 2, 'Un retry non inventa nuove importazioni');
tables.get('prodotti').get('MP-NUOVA').nome = 'Nome personalizzato';
await importMissingStockArticle({ supabase, article, productExists: true, cacheExists: true, onImported: () => assert.fail() });
assert.equal(tables.get('prodotti').get('MP-NUOVA').nome, 'Nome personalizzato');
await importMissingStockArticle({ supabase, article: { ...article, codice: 'ANNULLATO', gest_annullato: 'S' }, onImported: () => assert.fail() });
assert.equal(tables.get('prodotti').has('ANNULLATO'), false);
console.log('Stock isolation, cancellation, error/import checkpoints, idempotent catalogue creation: PASS');

const countBeforeExcluded = writes.length;
await importMissingStockArticle({ supabase, article: { ...article, codice: 'IT-FUORI' }, hierarchy: { linea: { descrizione: 'Sali di Ischia Fuori Produzione' } }, onImported: () => assert.fail('Non importare fuori produzione') });
assert.equal(writes.length, countBeforeExcluded);

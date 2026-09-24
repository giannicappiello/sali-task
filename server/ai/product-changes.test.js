import test from 'node:test';
import assert from 'node:assert/strict';
import { productChangePreview } from './product-changes.js';
const id = '10000000-0000-4000-8000-000000000001';
const forbiddenDatabase = { scoped: { from() { throw new Error('Database must not be reached'); } } };
test('bulk product validation rejects malformed values before accessing data', async () => {
  for (const changes of [{ nome: '' }, { nome: 42 }, { descrizione: {} }, { mostra_in_app: 'false' }, { prezzo: 10 }]) {
    await assert.rejects(productChangePreview(forbiddenDatabase, 'ARTICLE_UPDATE', { targetId: id, reason: 'Correzione richiesta', changes }), error => !error.message.includes('Database must'));
  }
});
test('bulk product preview requires every target to be visible', async () => {
  const auth = { scoped: { from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) } };
  await assert.rejects(productChangePreview(auth, 'ARTICLE_BULK_UPDATE', { reason: 'Correzione richiesta', items: [{ id, changes: { nome: 'Prodotto' } }] }), { status: 403 });
});

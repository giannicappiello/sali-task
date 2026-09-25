import assert from 'node:assert/strict';
import { processStockArticles, stockBatchCheckpoint } from '../server/mexal/lib/stockRunState.js';
const completed = [];
await processStockArticles(['A','B','C'], {
  shouldContinue: () => completed.length < 2,
  beforeArticle: async () => {},
  processArticle: async code => { completed.push(code); },
  onError: error => { throw error; },
});
assert.deepEqual(completed,['A','B']);
const checkpoint = stockBatchCheckpoint({ processed: 1584, metadata: { stock_state_version: 2, next_offset: 1584 } }, { processed: completed.length }, { total: 5972, batchSize: 3 });
assert.equal(checkpoint.values.processed,1586,'A time-limited block must not skip its unprocessed article');
const resumed = [];
await processStockArticles(['A','B','C'].slice(checkpoint.values.processed-1584), {
 beforeArticle: async () => {}, processArticle: async code => resumed.push(code), onError: error => { throw error; },
});
assert.deepEqual(resumed,['C']);
console.log('Partial block budget preserves exact resume cursor: PASS');

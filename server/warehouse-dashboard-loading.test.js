import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/pages/Warehouse/WarehouseDashboard.jsx', import.meta.url), 'utf8');
// Exercise the actual component callbacks with controlled transport and effects.
const loadBody = source.split('const load = useCallback(async () => {')[1].split('  }, [filters, query, stockFilter, type, unit, warehouse]);')[0];
const cancelBody = source.split('const cancelLoad = useCallback(() => {')[1].split('  }, []);')[0];
const effectBody = source.split('  useEffect(() => {')[1].split('  }, [cancelLoad, load, query, stockRevision]);')[0];
function fixture() {
  const requests = [], updates = [], errors = [], loading = [];
  const context = {
    requestSequence: { current: 0 }, activeRequest: { current: null },
    filters: {}, query: 'MP', stockFilter: 'all', type: 'TOTALE', unit: 'TUTTE', warehouse: 'TUTTI', supabase: {},
    setLoading: value => loading.push(value), setError: value => errors.push(value), setData: value => updates.push(value), setCatalog: () => {},
    loadWorkspaceWarehouse: (_db, _filters, { signal }) => new Promise((resolve, reject) => requests.push({ resolve, reject, signal })),
  };
  const load = new Function('context', `const {${Object.keys(context).join(',')}}=context; return async () => {${loadBody}};`)(context);
  const cancelLoad = new Function('context', `const {requestSequence,activeRequest}=context; ${cancelBody}`).bind(null, context);
  return { context, load, cancelLoad, requests, updates, errors, loading };
}
test('superseded warehouse requests are aborted and cannot replace newer results', async () => {
  const f = fixture();
  const first = f.load(), second = f.load();
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.requests[1].signal.aborted, false);
  f.requests[1].resolve({ rows: ['new'] }); await second;
  f.requests[0].resolve({ rows: ['old'] }); await first;
  assert.deepEqual(f.updates, [{ rows: ['new'] }]);
  assert.equal(f.context.activeRequest.current, null);
});
test('filter cleanup invalidates a running response immediately during the debounce', async () => {
  const f = fixture();
  let scheduled = false, cleared = false;
  const window = { setTimeout: () => { scheduled = true; return 7; }, clearTimeout: timer => { assert.equal(timer, 7); cleared = true; } };
  const cleanup = new Function('context', 'window', 'load', 'cancelLoad', `const {query,requestSequence,activeRequest}=context; ${effectBody}`)(f.context, window, f.load, f.cancelLoad);
  const pending = f.load(); cleanup();
  assert.ok(scheduled && cleared);
  assert.equal(f.requests[0].signal.aborted, true);
  f.requests[0].resolve({ rows: ['stale'] }); await pending;
  assert.deepEqual(f.updates, []);
});
test('a superseded failure is silent while the current failure remains visible', async () => {
  const f = fixture();
  const first = f.load(), second = f.load();
  f.requests[0].reject(new Error('old failure')); await first;
  f.requests[1].reject(new Error('current failure')); await second;
  assert.deepEqual(f.errors, ['', '', 'current failure']);
  assert.equal(f.loading.at(-1), false);
});

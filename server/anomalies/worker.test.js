import test from 'node:test';
import assert from 'node:assert/strict';
import { runDaily, handleAnomalyCron } from './worker.js';
const now = new Date('2026-11-10T06:00:00Z');
function db(agent, run = null) {
 const calls = [];
 return { calls, from(table) { calls.push(table); const q = { select() { return q; }, eq() { return q; }, single: async () => ({ data: agent }), maybeSingle: async () => ({ data: run }) }; return q; }, rpc: async (name, input) => { calls.push({ name, input }); return { data: { id: 'persisted-run' } }; } };
}
test('disabled and unverified agents never collect data or persist findings', async () => {
 for (const agent of [{ enabled: false }, { enabled: true, readiness: { ready: false } }]) {
  const database = db(agent); let collected = false;
  const result = await runDaily(database, { now, loadSnapshot: async () => { collected = true; } });
  assert(['disabled', 'blocked'].includes(result.status)); assert.equal(collected, false); assert.equal(database.calls.length, 1);
 }
});
test('completed or uncertain persisted run is never replayed', async () => {
 const database = db({ code: 'fabbisogni', enabled: true, readiness: { ready: true } }, { id: 'old', status: 'running' });
 let collected = false; const result = await runDaily(database, { now, loadSnapshot: async () => { collected = true; } });
 assert.equal(result.status, 'already_recorded'); assert.equal(collected, false);
});
test('incomplete coverage persists explicit gaps without sending messages or changing management data', async () => {
 const database = db({ code: 'fabbisogni', enabled: true, readiness: { ready: true } });
 const result = await runDaily(database, { now, loadSnapshot: async () => ({ coverage: {} }) });
 assert.equal(result.status, 'incomplete'); assert.equal(result.delivery, 'not_sent');
 const rpc = database.calls.find(x => x.name); assert.equal(rpc.name, 'anomaly_record_run'); assert.equal(rpc.input.p_coverage.gaps.length, 9);
});
test('cron rejects unauthorized requests before any database access', async () => {
 let accessed = false, code; const response = { setHeader() {}, status(x) { code = x; return this; }, json(x) { return x; } };
 await handleAnomalyCron({ method: 'GET', headers: { authorization: 'Bearer wrong' } }, response, { env: { CRON_SECRET: 'secret' }, admin() { accessed = true; } });
 assert.equal(code, 401); assert.equal(accessed, false);
});

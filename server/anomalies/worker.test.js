import test from 'node:test';
import assert from 'node:assert/strict';
import { runDaily, handleAnomalyCron } from './worker.js';
import { businessWindow } from './engine.js';
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

test('production source findings and coverage gaps survive daily ingestion', async () => {
 const database = db({code:'fabbisogni',enabled:true,readiness:{ready:true}});
 const finding={agent_code:'fabbisogni',fingerprint:'material-1',category:'material_shortage',severity:'high',title:'Materiale insufficiente',evidence:{jobId:42,shortage:5}};
 const gap={source:'stock_reconciliation',reason:'Cutoff non attestato'};
 const snapshot={kind:'analyzed-control-source',window:businessWindow(now),status:'incomplete',findings:[finding],gaps:[gap],coverage:{planning:{complete:true},stock_reconciliation:{complete:false,reason:gap.reason}},departmentIds:['dept-1']};
 const result=await runDaily(database,{now,loadSnapshot:async()=>snapshot});
 assert.equal(result.findingCount,1);assert.equal(result.gapCount,1);
 const recorded=database.calls.find(x=>x.name==='anomaly_record_run').input;
 assert.deepEqual(recorded.p_findings,[finding]);assert.deepEqual(recorded.p_coverage.gaps,[gap]);assert.deepEqual(recorded.p_coverage.departmentIds,['dept-1']);
 assert.equal(result.delivery,'not_sent');
});

test('analysis for another business day is rejected before persistence', async () => {
 const database=db({code:'fabbisogni',enabled:true,readiness:{ready:true}});
 await assert.rejects(runDaily(database,{now,loadSnapshot:async()=>({kind:'analyzed-control-source',window:{from:'2026-11-09',toExclusive:'2026-12-07'},findings:[],gaps:[]})}),/Invalid daily analysis contract/);
 assert.equal(database.calls.filter(x=>x.name).length,0);
});

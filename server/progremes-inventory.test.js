import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { handleInventorySnapshot, INVENTORY_PATH, validateInventorySnapshot } from "./progremes-inventory.js";
import { signProductionMessage, HMAC_HEADERS } from "./progremes-production-hmac.js";

const env = { PROGREMES_PRODUCTION_CALLBACKS_ENABLED: "true", PROGREMES_INTEGRATION_SECRET: "test-secret" };
const snapshot = () => ({ schemaVersion: 1, capturedAt: new Date().toISOString(), rows: [1,8].map(warehouse_number => ({
  article_code: "CN0643", warehouse_number, on_hand: warehouse_number === 8 ? 32000 : 0,
  committed: 0, available: warehouse_number === 8 ? 32000 : 0, unit_cost: 0.05, unit_of_measure: "PZ" })) });
function request(body = snapshot()) {
  const timestamp = String(Math.floor(Date.now()/1000));
  const eventId = randomUUID();
  return { method: "POST", body, headers: { [HMAC_HEADERS.timestamp]: timestamp, [HMAC_HEADERS.eventId]: eventId,
    [HMAC_HEADERS.signature]: signProductionMessage({ method: "POST", path: INVENTORY_PATH, timestamp, eventId,
      body: JSON.stringify(body), secret: env.PROGREMES_INTEGRATION_SECRET }) } };
}
function response() { return { status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } }; }

test("signed CN0643 snapshot delivers the same physical balance for both warehouses in one RPC", async () => {
  const req=request(), res=response(); let calls=0;
  await handleInventorySnapshot(req,res,{ env, admin: { rpc: async (name,args) => {
    if (name === "replay_workspace_mes_inventory_pending") return {data:{pendingArticles:0}};
    calls++; assert.equal(name,"apply_workspace_mes_inventory"); assert.equal(args.p_rows[1].on_hand,32000);
    assert.equal(args.p_captured_at,req.body.capturedAt); return {data:{applied:true}}; } } });
  assert.equal(res.code,200); assert.equal(calls,1);
});
test("tampered stock is rejected before accessing the database", async () => {
  const req=request(),res=response(); req.body.rows[1].on_hand=36000;
  await handleInventorySnapshot(req,res,{env,admin:{rpc:()=>{throw Error("Must not execute");}}});
  assert.equal(res.code,401);
});
test("partial warehouse pairs, duplicates and invalid quantities are rejected", () => {
  const value=snapshot(); value.rows.pop(); assert.equal(validateInventorySnapshot(value),false);
  const duplicate=snapshot(); duplicate.rows.push(duplicate.rows[1]); assert.equal(validateInventorySnapshot(duplicate),false);
  const invalid=snapshot(); invalid.rows[1].on_hand=NaN; assert.equal(validateInventorySnapshot(invalid),false);
});
test("database failure is retryable and must not acknowledge delivery", async () => {
  const res=response(); await handleInventorySnapshot(request(),res,{env,admin:{rpc:async()=>({error:Error("transaction failed")})}});
  assert.equal(res.code,503); assert.equal(res.value.code,"INVENTORY_APPLY_FAILED");
});

test("MES text payload preserves decimal zeros and whitespace for HMAC verification", async () => {
  const raw = JSON.stringify(snapshot()).replace('32000', '32000.000') + ' ';
  const req = request(); req.body = raw;
  req.headers[HMAC_HEADERS.signature] = signProductionMessage({ method: "POST", path: INVENTORY_PATH,
    timestamp: req.headers[HMAC_HEADERS.timestamp], eventId: req.headers[HMAC_HEADERS.eventId], body: raw,
    secret: env.PROGREMES_INTEGRATION_SECRET });
  const res = response(); let calls = 0;
  await handleInventorySnapshot(req, res, { env, admin: { rpc: async (_name, args) => {
    if (_name === "replay_workspace_mes_inventory_pending") return {data:{pendingArticles:0}};
    calls++; assert.equal(args.p_rows[1].on_hand, 32000); return { data: { applied: true } };
  } } });
  assert.equal(res.code, 200); assert.equal(calls, 1);
  req.body = JSON.parse(raw);
  const parsedRes = response();
  await handleInventorySnapshot(req, parsedRes, { env, admin: { rpc: () => { throw Error("Must not execute"); } } });
  assert.equal(parsedRes.code, 401);
});

test("valid Mexal codes with ampersand, comma and percent are accepted without weakening quantity checks", () => {
  for (const code of ["&ART.395", "26X17,5X25X5", "MP3114-SOL.2%"]) {
    const value=snapshot(); value.rows.forEach(row=>row.article_code=code);
    assert.equal(validateInventorySnapshot(value),true);
  }
  const bad=snapshot(); bad.rows.forEach(row=>row.article_code="<BAD>");
  assert.equal(validateInventorySnapshot(bad),false);
});
test("catalog backlog is acknowledged only after durable storage and reported to MES", async () => {
  const res=response(); const names=[];
  await handleInventorySnapshot(request(),res,{env,admin:{rpc:async name=>{
    names.push(name); return {data:{applied:true,pendingArticles:7}};
  }}});
  assert.equal(res.code,200); assert.equal(res.value.status.pendingArticles,7);
  assert.deepEqual(names,["apply_workspace_mes_inventory","replay_workspace_mes_inventory_pending"]);
});
test("deferred replay failure preserves successful delivery and its catalog warning", async () => {
  const res=response();
  await handleInventorySnapshot(request(),res,{env,admin:{rpc:async name=> name==="apply_workspace_mes_inventory"
    ? {data:{applied:true,pendingArticles:3}} : {error:Error("deferred")}}});
  assert.equal(res.code,200); assert.equal(res.value.status.pendingArticles,3);
});

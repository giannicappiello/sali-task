import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { cancelCoordinatedProductionRequest } from "./workspacemes-cancel-coordinator.js";
import { evaluateProductionRequestCancellation } from "./workspacemes-rdp-cancellation.js";
import { createProgremesProductionClient } from "./progremes-production-client.js";
import { HMAC_HEADERS, verifyProductionMessage } from "./progremes-production-hmac.js";

function fixture(overrides = {}) {
  const calls = [];
  const operation = { status: "PREPARED", external_id: "rdp-external", confirmations: ["confirmation-1"], reason: "Motivo persistito", actor_id: "actor-1", ...overrides };
  return { calls, operation, admin: { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: name.startsWith("prepare") ? operation : { ...operation, status: "COMPLETED" } };
  } } };
}

test("CONFIRMED/PLANNED V4 sono richiedibili: gli effetti devono essere verificati da MES", () => {
  for (const status of ["CONFIRMED", "PLANNED", "READY", "FORECAST"]) {
    assert.equal(evaluateProductionRequestCancellation({ request: { contract_version: 4, workspace_status: status },
      proposals: [{ mes_production_order_id: 42 }], events: [{ event_type: "LotCreated" }] }).code, "MES_VERIFICATION_REQUIRED");
  }
  for (const status of ["InProduction", "Completed", "Cancelled"])
    assert.equal(evaluateProductionRequestCancellation({ request: { contract_version: 4, workspace_status: status } }).allowed, false);
});

test("annullamento MES precede il commit Workspace e usa motivo/attore persistiti", async () => {
  const f = fixture();
  const result = await cancelCoordinatedProductionRequest({ admin: f.admin, requestId: "rdp", reason: "nuovo motivo", requestedBy: "other",
    client: { cancelV4: async (id, payload) => {
      assert.equal(f.calls.length, 1); assert.equal(id, "rdp-external");
      assert.equal(payload.reason, "Motivo persistito"); assert.equal(payload.cancelledBy, "workspace:actor-1");
      f.calls.push({ name: "mes" }); return { result: { status: "CANCELLED" } };
    } } });
  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(f.calls.map(c => c.name), ["prepare_workspace_rdp_cancellation", "mes", "complete_workspace_rdp_cancellation"]);
});

test("timeout, rifiuto MES e risposta non valida non annullano Workspace", async () => {
  for (const response of [new Error("timeout"), Object.assign(new Error("Movimenti registrati"), { status: 409 }), { result: { status: "CONFIRMED" } }]) {
    const f = fixture();
    await assert.rejects(cancelCoordinatedProductionRequest({ admin: f.admin, requestId: "rdp", client: { cancelV4: async () => {
      if (response instanceof Error) throw response; return response;
    } } }));
    assert.equal(f.calls.length, 1);
  }
});

test("ripetizione annullamento già completato non richiama MES", async () => {
  const f = fixture({ status: "COMPLETED" });
  await cancelCoordinatedProductionRequest({ admin: f.admin, requestId: "rdp", client: { cancelV4: () => assert.fail("MES not expected") } });
  assert.equal(f.calls.length, 1);
});

test("rifiuto tecnico certo non lascia congelata la RdP, ma un esito parziale sì", async () => {
  for (const partial of [false, true]) {
    const f = fixture({ confirmations: partial ? ["first", "second"] : ["first"] });
    const refusal = Object.assign(new Error("SL registrato"), { status: 400, code: "V4_ORDER_IRREVERSIBLE" });
    let calls = 0;
    await assert.rejects(cancelCoordinatedProductionRequest({ admin: f.admin, requestId: "rdp", client: { cancelV4: async () => {
      if (partial && calls++ === 0) return { result: { status: "CANCELLED" } }; throw refusal;
    } } }), /SL registrato/);
    assert.equal(f.calls.some(c => c.name === "reject_workspace_rdp_cancellation"), !partial);
    assert.equal(f.calls.some(c => c.name === "complete_workspace_rdp_cancellation"), false);
  }
});

test("errore del commit locale viene propagato e il retry richiama idempotentemente MES", async () => {
  const f = fixture(); let count = 0;
  const rpc = f.admin.rpc;
  f.admin.rpc = async (name, args) => name.startsWith("complete") && count === 1 ? { error: new Error("database unavailable") } : rpc(name, args);
  const input = { admin: f.admin, requestId: "rdp", client: { cancelV4: async () => { count++; return { result: { status: "CANCELLED" } }; } } };
  await assert.rejects(cancelCoordinatedProductionRequest(input), /database unavailable/);
  assert.equal((await cancelCoordinatedProductionRequest(input)).status, "COMPLETED"); assert.equal(count, 2);
});

test("cancellazione V4 firmata con identificativo RdP, mai undefined", async () => {
  const externalId = "00000000-0000-4000-8000-000000000001";
  const client = createProgremesProductionClient({ env: { PROGREMES_URL: "https://mes.example.test", PROGREMES_INTEGRATION_SECRET: "test-secret" },
    fetchImpl: async (url, init) => {
      assert.equal(init.headers[HMAC_HEADERS.eventId], externalId);
      assert.equal(verifyProductionMessage({ method: "POST", path: new URL(url).pathname, headers: init.headers, body: Buffer.from(init.body), secret: "test-secret" }), true);
      return { ok: true, json: async () => ({ status: "CANCELLED" }) };
    } });
  await client.cancelV4(externalId, { contractVersion: 4, confirmationExternalId: "confirmation-1", reason: "Annullamento test", cancelledBy: "workspace:test" });
});

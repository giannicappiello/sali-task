import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { cancelCoordinatedProductionRequest, previewCoordinatedProductionCancellation } from "./workspacemes-cancel-coordinator.js";
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

const reviewed = (id = "confirmation-1") => ({ confirmationExternalId: id, stateHash: "a".repeat(64) });
const finishedOrder = { id: 5311, number: "RdP55", status: "Completato" };
const residualOrder = { id: 5312, number: "RdP55-02", status: "Pianificato" };

test("residuo: invia lo stato verificato e restituisce separatamente OP conservati e annullati", async () => {
  const f = fixture();
  const result = await cancelCoordinatedProductionRequest({ admin: f.admin, requestId: "rdp", previews: [reviewed()], client: {
    cancelV4: async (id, payload) => {
      assert.equal(id, "rdp-external"); assert.equal(payload.preserveCompleted, true);
      assert.equal(payload.expectedStateHash, reviewed().stateHash);
      return { result: { status: "CANCELLED", cancelledOrders: [residualOrder], preservedOrders: [finishedOrder] } };
    },
  } });
  assert.deepEqual(result.cancelledOrders, [residualOrder]); assert.deepEqual(result.preservedOrders, [finishedOrder]);
  assert.equal(f.calls.at(-1).name, "complete_workspace_rdp_cancellation");
});

test("anteprima scaduta rifiutata senza commit; esito parziale resta protetto", async () => {
  for (const partial of [false, true]) {
    const f = fixture({ confirmations: partial ? ["first", "second"] : ["first"] }); let count = 0;
    await assert.rejects(cancelCoordinatedProductionRequest({ admin: f.admin, requestId: "rdp", previews: f.operation.confirmations.map(reviewed), client: {
      cancelV4: async () => {
        if (partial && count++ === 0) return { result: { status: "CANCELLED" } };
        throw Object.assign(new Error("Stato modificato"), { code: "V4_CANCELLATION_STALE", status: 400 });
      },
    } }), /Stato modificato/);
    assert.equal(f.calls.some(row => row.name.startsWith("reject")), !partial);
    assert.equal(f.calls.some(row => row.name.startsWith("complete")), false);
  }
});

test("anteprima assente, duplicata o riferita ad altre conferme non abilita il recupero residuo", async () => {
  for (const previews of [[{ ...reviewed(), stateHash: "" }], [reviewed(), reviewed()], [reviewed("other")], []]) {
    const f = fixture();
    await assert.rejects(cancelCoordinatedProductionRequest({ admin: f.admin, requestId: "rdp", previews, client: { cancelV4: () => assert.fail("MES not expected") } }));
    assert.equal(f.calls.some(row => row.name.startsWith("complete") || row.name.startsWith("reject")), false);
  }
});

function previewFixture(mirrors = [{ external_id: "confirmation-1", status: "CONFIRMED" }]) {
  const reads = [];
  const tables = { workspace_production_requests: { id: "rdp", external_id: "rdp-external", contract_version: 4, workspace_status: "CONFIRMED" },
    workspace_v4_previews: [{ id: "preview", status: "CONFIRMED" }], workspace_v4_confirmation_mirrors: mirrors };
  return { reads, admin: { rpc: () => assert.fail("Anteprima senza scritture"), from: table => {
    reads.push(table); const query = { select() { return this; }, eq() { return this; }, in() { return this; },
      order() { return this; }, single() { return this; }, then(resolve) { return Promise.resolve({ data: tables[table] }).then(resolve); } };
    return query;
  } } };
}

test("anteprima di OC/2/166 legge tutti i collegamenti senza preparare annullamenti", async () => {
  const f = previewFixture();
  const result = await previewCoordinatedProductionCancellation({ admin: f.admin, requestId: "rdp", client: {
    previewCancellationV4: async (id, payload) => {
      assert.equal(id, "rdp-external"); assert.equal(payload.preserveCompleted, true);
      return { result: { ...reviewed(), allowed: true, cancelledOrders: [residualOrder], preservedOrders: [finishedOrder], blocks: [] } };
    },
  } });
  assert.equal(result.allowed, true); assert.deepEqual(result.preservedOrders, [finishedOrder]);
  assert.deepEqual(result.cancelledOrders, [residualOrder]); assert.equal(f.reads.length, 3);
});

test("conferma mancante o anteprima MES non valida bloccano l’annullamento", async () => {
  await assert.rejects(previewCoordinatedProductionCancellation({ admin: previewFixture([]).admin, requestId: "rdp", client: {} }), /riconciliare/);
  await assert.rejects(previewCoordinatedProductionCancellation({ admin: previewFixture().admin, requestId: "rdp", client: {
    previewCancellationV4: async () => ({ result: { ...reviewed(), allowed: true } }),
  } }), /Anteprima MES non valida/);
});

test("anteprima MES firmata e dedicata alla RdP selezionata", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const client = createProgremesProductionClient({ env: { PROGREMES_URL: "https://mes.example.test", PROGREMES_INTEGRATION_SECRET: "test-secret" },
    fetchImpl: async (url, init) => {
      assert.equal(new URL(url).pathname, `/api/workspace/v4/production-requests/${id}/cancellation-preview`);
      assert.equal(verifyProductionMessage({ method: "POST", path: new URL(url).pathname, headers: init.headers, body: Buffer.from(init.body), secret: "test-secret" }), true);
      return { ok: true, json: async () => ({ allowed: true }) };
    } });
  await client.previewCancellationV4(id, { contractVersion: 4, confirmationExternalId: "confirmation-1", preserveCompleted: true });
});

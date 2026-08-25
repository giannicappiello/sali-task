import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildProductionDemand,
  prepareDemandQuantity,
  prepareProductionDemand,
  productionDemandContract,
} from "./production-netting.js";
import { previewProductionRequest, sendProductionRequest } from "./progremes-production-api.js";
import { createProductionRequestSubmitter } from "../src/modules/orders/services/productionRequest.js";

const ORDERS = [
  { id: "00000000-0000-4000-8000-000000000101", origine: "mexal_oct", mexal_chiave: "OC+2+412", mexal_sigla: "OC", mexal_serie: 2, mexal_numero: 412, mexal_cod_conto: "C1", data_ordine: "2026-08-06", data_consegna: "2026-09-01" },
  { id: "00000000-0000-4000-8000-000000000102", origine: "mexal_oct", mexal_chiave: "OC+2+430", mexal_sigla: "OC", mexal_serie: 2, mexal_numero: 430, mexal_cod_conto: "C2", data_ordine: "2026-08-07", data_consegna: "2026-09-02" },
];
const LINES = [
  { id: "00000000-0000-4000-8000-000000000201", ordine_id: ORDERS[0].id, mexal_posizione: 10, codice_articolo: "PB0004", quantita: 10.25, unita_misura_oct: "PZ", data_consegna: "2026-08-30", riga_descrittiva: false },
  { id: "00000000-0000-4000-8000-000000000202", ordine_id: ORDERS[0].id, mexal_posizione: 20, codice_articolo: null, quantita: 0, unita_misura_oct: null, riga_descrittiva: true },
  { id: "00000000-0000-4000-8000-000000000204", ordine_id: ORDERS[0].id, mexal_posizione: 30, codice_articolo: "PB0005", quantita: 3.5, unita_misura_oct: "KG", riga_descrittiva: false },
  { id: "00000000-0000-4000-8000-000000000203", ordine_id: ORDERS[1].id, mexal_posizione: 10, codice_articolo: "PB0004", quantita: 4, unita_misura_oct: "PZ", riga_descrittiva: false },
];

function queryRows(rows) {
  let current = [...rows];
  const query = {
    select() { return query; },
    in(column, values) { current = current.filter((row) => values.includes(String(row[column]))); return Promise.resolve({ data: current, error: null }); },
  };
  return query;
}

function catalogQuery(catalogs) {
  let code;
  const query = {
    select() { return query; },
    eq(_column, value) { code = value; return query; },
    async maybeSingle() { return { data: catalogs[code] || null, error: null }; },
  };
  return query;
}

function makeAdmin({ rpcResult, rpcError = null, onRpc = () => {}, onUpdate = () => {}, onProposal = () => {}, requestItems = [] } = {}) {
  const catalogs = {
    PB0004: { codice_articolo: "PB0004", unita_misura: "PZ", sincronizzato_il: "2026-08-24T20:00:00Z" },
    PB0005: { codice_articolo: "PB0005", unita_misura: "KG", sincronizzato_il: "2026-08-24T20:00:00Z" },
  };
  return {
    from(table) {
      if (table === "ordini_righe") return queryRows(LINES);
      if (table === "ordini_testate") return queryRows(ORDERS);
      if (table === "ordini_prodotti_cache") return catalogQuery(catalogs);
      if (table === "workspace_production_requests") return {
        update(value) { onUpdate(value); return { eq: async () => ({ error: null }) }; },
      };
      if (table === "workspace_production_request_items") {
        const query = { select() { return query; }, async eq() { return { data: requestItems, error: null }; } };
        return query;
      }
      if (table === "workspace_production_proposals") return { upsert: async (rows) => { onProposal(rows); return { error: null }; } };
      throw new Error(`Tabella inattesa: ${table}`);
    },
    async rpc(name, args) {
      onRpc(name, args);
      return { data: rpcResult ?? [{ request_id: null, external_id: null, snapshot_id: 12, snapshot_hash: "snapshot-hash", snapshot_captured_at: "2026-08-24T20:00:00Z", reused: false, attempt_count: 0 }], error: rpcError };
    },
  };
}

function responseRecorder() {
  const value = { status: null, payload: null };
  return {
    value,
    response: { status(status) { value.status = status; return { json(payload) { value.payload = payload; return payload; } }; } },
  };
}

test("quantità OCT decimali sono preservate integralmente e non nettificate", () => {
  const value = prepareDemandQuantity({ requestedQuantity: 10.275, lineUnitOfMeasure: " pz. ", productUnitOfMeasure: "PZ" });
  assert.equal(value.requestedQuantity, 10.275);
  assert.equal(value.productionQuantity, 10.275);
  assert.equal("availableQuantity" in value, false);
  assert.equal("quantityToProduce" in value, false);
});

test("UDM incoerente blocca senza conversione autorevole", () => {
  assert.throws(() => prepareDemandQuantity({ requestedQuantity: 2, lineUnitOfMeasure: "CF", productUnitOfMeasure: "PZ" }), { code: "UOM_MISMATCH" });
  assert.throws(() => prepareDemandQuantity({ requestedQuantity: 2, lineUnitOfMeasure: null, productUnitOfMeasure: "PZ" }), { code: "OCT_UOM_MISSING" });
});

test("conversione esplicita preserva quantità originale e fonte tecnica", () => {
  const value = prepareDemandQuantity({ requestedQuantity: 2, lineUnitOfMeasure: "CF", productUnitOfMeasure: "PZ",
    conversions: [{ from: "CF", to: "PZ", factor: 6, source: "MASTER_DATA_APPROVED" }] });
  assert.deepEqual([value.requestedQuantity, value.productionQuantity], [2, 12]);
  assert.equal(value.conversion.source, "MASTER_DATA_APPROVED");
});

test("una RdP contiene più OCT, conserva righe omonime ed esclude descrizioni", async () => {
  const demand = await buildProductionDemand({ admin: makeAdmin(), orderIds: ORDERS.map((order) => order.id) });
  assert.equal(demand.orders.length, 2);
  assert.equal(demand.items.length, 3);
  assert.deepEqual(demand.items.map((item) => item.commercialArticleCode), ["PB0004", "PB0005", "PB0004"]);
  assert.deepEqual(demand.items.map((item) => item.mexalOrderKey), ["OC+2+412", "OC+2+412", "OC+2+430"]);
  assert.deepEqual(demand.items.map((item) => item.requestedQuantity), [10.25, 3.5, 4]);
  assert.notEqual(demand.items[0].itemExternalKey, demand.items[2].itemExternalKey);
});

test("una RdP con un solo OCT conserva tutte le sue righe articolo", async () => {
  const demand = await buildProductionDemand({ admin: makeAdmin(), orderIds: [ORDERS[0].id] });
  assert.equal(demand.orders.length, 1);
  assert.equal(demand.items.length, 2);
  assert.deepEqual(demand.items.map((item) => item.mexalLinePosition), [10, 30]);
});

test("contratto dichiara ProgreMES master della nettificazione", async () => {
  const demand = await buildProductionDemand({ admin: makeAdmin(), orderIds: [ORDERS[0].id] });
  const contract = productionDemandContract(demand);
  assert.equal(contract.items[0].nettingOwner, "PROGREMES");
  assert.equal(contract.items[0].workspaceAvailabilityAuthoritative, false);
  assert.equal(JSON.stringify(contract).includes("quantityToProduce"), false);
  assert.equal(JSON.stringify(contract).includes("availableFinishedProduct"), false);
});

test("preview registra solo snapshot della domanda e non crea una RdP", async () => {
  let rpcArgs;
  const recorder = responseRecorder();
  await previewProductionRequest({ method: "POST", body: { orderIds: [ORDERS[0].id, ORDERS[1].id] } }, recorder.response, {
    admin: makeAdmin({ onRpc: (_name, args) => { rpcArgs = args; } }),
    requestedBy: "00000000-0000-4000-8000-000000000301",
  });
  assert.equal(recorder.value.status, 200);
  assert.equal(recorder.value.payload.sent, false);
  assert.equal(recorder.value.payload.demand.orderCount, 2);
  assert.equal(rpcArgs.p_create_request, false);
  assert.equal(rpcArgs.p_snapshot.availability.authoritative, false);
  assert.equal(rpcArgs.p_snapshot.availability.included, false);
});

test("invio usa stessa RdP, schema v2 e quantità OCT complete", async () => {
  let outbound;
  let update;
  const recorder = responseRecorder();
  const requestId = "00000000-0000-4000-8000-000000000401";
  const externalId = "00000000-0000-4000-8000-000000000402";
  const admin = makeAdmin({
    rpcResult: [{ request_id: requestId, external_id: externalId, snapshot_id: 12, snapshot_hash: "snapshot-hash", snapshot_captured_at: "2026-08-24T20:00:00Z", reused: true, attempt_count: 1 }],
    onUpdate: (value) => { update = value; },
  });
  const client = {
    requestEnabled: () => true,
    async sendRequest(payload) { outbound = payload; return { result: { status: "RICEVUTA", workspaceStatus: "RICEVUTA", proposals: [] }, payloadHash: "payload-hash" }; },
  };
  await sendProductionRequest({ method: "POST", body: { orderIds: ORDERS.map((order) => order.id), snapshotId: 12 } }, recorder.response, { admin, client });
  assert.equal(recorder.value.status, 200);
  assert.equal(outbound.schemaVersion, 2);
  assert.equal(outbound.requestType, "MULTI_OCT_PRODUCTION_DEMAND");
  assert.equal(outbound.items.length, 3);
  assert.deepEqual(outbound.items.map((item) => item.requested.value), [10.25, 3.5, 4]);
  assert.equal(outbound.availabilityOwner, "PROGREMES");
  assert.equal(JSON.stringify(outbound).includes("availableFinishedProduct"), false);
  assert.equal(update.sent_demand_snapshot_id, 12);
});

test("snapshot cambiato tra preview e invio blocca prima della chiamata MES", async () => {
  let calls = 0;
  const recorder = responseRecorder();
  const admin = makeAdmin({ rpcResult: [{ request_id: "r", external_id: "e", snapshot_id: 13, snapshot_hash: "new", reused: false, attempt_count: 0 }] });
  const client = { requestEnabled: () => true, async sendRequest() { calls += 1; } };
  await sendProductionRequest({ method: "POST", body: { orderIds: [ORDERS[0].id], snapshotId: 12 } }, recorder.response, { admin, client });
  assert.equal(recorder.value.status, 409);
  assert.equal(recorder.value.payload.code, "DEMAND_CHANGED");
  assert.equal(calls, 0);
});

test("errore di invio conserva tentativo e codice senza perdere la RdP", async () => {
  let update;
  const recorder = responseRecorder();
  const admin = makeAdmin({
    rpcResult: [{ request_id: "r", external_id: "e", snapshot_id: 12, snapshot_hash: "hash", reused: true, attempt_count: 2 }],
    onUpdate: (value) => { update = value; },
  });
  const client = {
    requestEnabled: () => true,
    async sendRequest() { throw Object.assign(new Error("timeout"), { code: "UPSTREAM_TIMEOUT" }); },
  };
  await assert.rejects(() => sendProductionRequest({ method: "POST", body: { orderIds: [ORDERS[0].id] } }, recorder.response, { admin, client }), /timeout/);
  assert.equal(update.last_error_code, "UPSTREAM_TIMEOUT");
  assert.equal(update.attempt_count, 3);
});

test("proposta MES viene persistita con collegamento alla riga OCT originaria", async () => {
  let proposals;
  const recorder = responseRecorder();
  const requestId = "00000000-0000-4000-8000-000000000401";
  const key = "OC+2+412:10";
  const admin = makeAdmin({
    rpcResult: [{ request_id: requestId, external_id: "e", snapshot_id: 12, snapshot_hash: "hash", reused: true, attempt_count: 0 }],
    requestItems: [{ id: "00000000-0000-4000-8000-000000000501", item_external_key: key }],
    onProposal: (rows) => { proposals = rows; },
  });
  const client = {
    requestEnabled: () => true,
    async sendRequest() {
      return { result: { status: "IN_ANALISI", workspaceStatus: "IN_ANALISI", proposals: [{ id: 7, itemExternalKey: key, productionIndex: 1,
        quantity: 10.25, status: "DaVerificare", materialStatus: "DA_VERIFICARE", expectedMaterialAvailability: null,
        productionOrderId: null, productionOrderNumber: null }] }, payloadHash: "payload-hash" };
    },
  };
  await sendProductionRequest({ method: "POST", body: { lineIds: [LINES[0].id] } }, recorder.response, { admin, client });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].item_external_key, key);
  assert.equal(proposals[0].production_request_item_id, "00000000-0000-4000-8000-000000000501");
});

test("conflitto idempotente viene restituito come errore controllato", async () => {
  await assert.rejects(() => prepareProductionDemand({
    admin: makeAdmin({ rpcError: { message: "IDEMPOTENCY_CONFLICT" } }),
    orderIds: [ORDERS[0].id],
    mode: "send",
  }), { code: "IDEMPOTENCY_CONFLICT", status: 409 });
});

test("flag invio OFF blocca prima di qualsiasi lettura o scrittura", async () => {
  let touched = false;
  const recorder = responseRecorder();
  await sendProductionRequest({ method: "POST", body: { orderIds: [ORDERS[0].id] } }, recorder.response, {
    admin: { from() { touched = true; }, rpc() { touched = true; } },
    client: { requestEnabled: () => false },
  });
  assert.equal(recorder.value.status, 403);
  assert.equal(recorder.value.payload.code, "MODULE_DISABLED");
  assert.equal(touched, false);
});

test("doppio click concorrente produce una sola richiesta client con più OCT", async () => {
  let calls = 0;
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const submit = createProductionRequestSubmitter(async (payload) => {
    calls += 1;
    await wait;
    return payload;
  });
  const selection = { orderIds: ORDERS.map((order) => order.id), snapshotId: 12 };
  const first = submit(selection);
  const second = submit(selection);
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(left, right);
  assert.equal(left.action, "progremes_production_request");
  assert.equal(left.orderIds.length, 2);
});

test("migration separa testata, righe e snapshot e non contiene nettificazione Workspace", () => {
  const migration = fs.readFileSync(new URL("../supabase/migrations/20260824220000_phase1_pf_netting_udm.sql", import.meta.url), "utf8");
  assert.match(migration, /workspace_production_request_items/);
  assert.match(migration, /workspace_production_demand_snapshots/);
  assert.match(migration, /record_workspace_production_demand/);
  assert.match(migration, /IDEMPOTENCY_CONFLICT/);
  assert.doesNotMatch(migration, /quantita_da_produrre/);
  assert.doesNotMatch(migration, /quantita_disponibile_pf/);
  assert.doesNotMatch(migration, /AVAILABILITY_CHANGED/);
  assert.doesNotMatch(migration, /\bdrop\b/i);
  assert.doesNotMatch(migration, /alter\s+column\s+ordine_(?:id|riga_id)\s+drop\s+not\s+null/i);
  assert.match(migration, /\(p_snapshot->'items'->0\)->>'orderId'/);
  assert.match(migration, /\(p_snapshot->'items'->0\)->>'lineId'/);
});

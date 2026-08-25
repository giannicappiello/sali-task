import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { calculateProductionNetting, finishedProductWarehouseRule, prepareProductionNetting } from "./production-netting.js";
import { confirmProductionProposal, previewProductionRequest, sendProductionRequest } from "./progremes-production-api.js";

test("quantità totalmente coperta produce residuo zero senza valori negativi", () => {
  const value = calculateProductionNetting({ requestedQuantity: 10, availableQuantity: 15, lineUnitOfMeasure: "PZ", productUnitOfMeasure: "pz" });
  assert.deepEqual([value.coveredQuantity, value.quantityToProduce, value.fullyCovered], [10, 0, true]);
});

test("quantità parzialmente coperta produce soltanto il residuo", () => {
  const value = calculateProductionNetting({ requestedQuantity: 10, availableQuantity: 3, lineUnitOfMeasure: "PZ", productUnitOfMeasure: "PZ" });
  assert.deepEqual([value.availableQuantity, value.coveredQuantity, value.quantityToProduce], [3, 3, 7]);
});

test("nessuna disponibilità mantiene l'intera quantità da produrre", () => {
  const value = calculateProductionNetting({ requestedQuantity: 8, availableQuantity: 0, lineUnitOfMeasure: "PZ", productUnitOfMeasure: "PZ" });
  assert.deepEqual([value.coveredQuantity, value.quantityToProduce, value.unitSource], [0, 8, "OCT"]);
});

test("disponibilità uguale alla richiesta produce residuo zero", () => {
  const value = calculateProductionNetting({ requestedQuantity: 1000, availableQuantity: 1000, lineUnitOfMeasure: "PZ", productUnitOfMeasure: "PZ" });
  assert.deepEqual([value.coveredQuantity, value.quantityToProduce, value.fullyCovered], [1000, 0, true]);
});

test("quantità o disponibilità non determinabili bloccano il calcolo", () => {
  assert.throws(() => calculateProductionNetting({ requestedQuantity: null, availableQuantity: 0, lineUnitOfMeasure: "PZ", productUnitOfMeasure: "PZ" }), { code: "QUANTITY_MISSING" });
  assert.throws(() => calculateProductionNetting({ requestedQuantity: 1, availableQuantity: null, lineUnitOfMeasure: "PZ", productUnitOfMeasure: "PZ" }), { code: "AVAILABILITY_UNAVAILABLE" });
});

test("quantità decimali sono preservate con precisione deterministica", () => {
  const value = calculateProductionNetting({ requestedQuantity: 3.275, availableQuantity: 1.125, lineUnitOfMeasure: "KG", productUnitOfMeasure: "KG" });
  assert.deepEqual([value.coveredQuantity, value.quantityToProduce], [1.125, 2.15]);
});

test("disponibilità negativa viene protetta a zero con warning e quantità OCT negativa è rifiutata", () => {
  const anomalous = calculateProductionNetting({ requestedQuantity: 2, availableQuantity: -5, lineUnitOfMeasure: "PZ", productUnitOfMeasure: "PZ" });
  assert.equal(anomalous.availableQuantity, 0);
  assert.deepEqual(anomalous.warnings.map((warning) => warning.code), ["NEGATIVE_AVAILABILITY_CLAMPED"]);
  assert.throws(() => calculateProductionNetting({ requestedQuantity: -1, availableQuantity: 0, lineUnitOfMeasure: "PZ", productUnitOfMeasure: "PZ" }), { code: "NEGATIVE_QUANTITY" });
});

test("UDM coerente passa, UDM mancante o mismatch senza conversione esplicita vengono bloccati", () => {
  assert.equal(calculateProductionNetting({ requestedQuantity: 2, availableQuantity: 0, lineUnitOfMeasure: " pz. ", productUnitOfMeasure: "PZ" }).effectiveUnitOfMeasure, "PZ");
  assert.throws(() => calculateProductionNetting({ requestedQuantity: 2, availableQuantity: 0, productUnitOfMeasure: "PZ" }), { code: "OCT_UOM_MISSING" });
  assert.throws(() => calculateProductionNetting({ requestedQuantity: 2, availableQuantity: 0, lineUnitOfMeasure: "CF", productUnitOfMeasure: "PZ" }), { code: "UOM_MISMATCH" });
});

test("conversioni sono applicate solo se esplicite e tracciate", () => {
  const value = calculateProductionNetting({ requestedQuantity: 2, availableQuantity: 3, lineUnitOfMeasure: "CF", productUnitOfMeasure: "PZ",
    conversions: [{ from: "CF", to: "PZ", factor: 6, source: "MASTER_DATA_APPROVED" }] });
  assert.deepEqual([value.requestedQuantityInProductUom, value.coveredQuantity, value.quantityToProduce], [12, 3, 9]);
  assert.equal(value.conversion.source, "MASTER_DATA_APPROVED");
});

test("regola magazzini è esplicita per IT/MKT e per gli altri articoli", () => {
  assert.deepEqual(finishedProductWarehouseRule("IT001").warehouses, [5]);
  assert.deepEqual(finishedProductWarehouseRule("MKT-1").warehouses, [5]);
  assert.equal(finishedProductWarehouseRule("PB0004").warehouses, null);
});

function query(data) {
  const chain = { select: () => chain, eq: () => chain, single: async () => ({ data, error: null }), maybeSingle: async () => ({ data, error: null }) };
  return chain;
}

function fakeAdmin({ availability = 4, snapshotIds = [31, 31] } = {}) {
  let rpcCalls = 0;
  const rows = {
    ordini_righe: { id: "line-1", ordine_id: "order-1", codice_articolo: "PB0004", quantita: 10, unita_misura_oct: "PZ", riga_descrittiva: false },
    ordini_testate: { id: "order-1", origine: "mexal_oct", mexal_chiave: "OC+2+412", data_ordine: "2026-08-06", mexal_cod_conto: "C1" },
    prodotti: { id: "product-1", codice_mexal: "PB0004", disponibilita: availability, sincronizzato_mexal: true, attivo_mexal: true, updated_at: "2026-08-24T20:00:00Z", ultimo_sync_mexal: "2026-08-24T19:00:00Z" },
    ordini_prodotti_cache: { codice_articolo: "PB0004", unita_misura: "PZ", sincronizzato_il: "2026-08-24T18:00:00Z" },
  };
  return {
    get rpcCalls() { return rpcCalls; },
    from: (table) => query(rows[table]),
    rpc: async (_name, payload) => {
      const index = rpcCalls++;
      assert.equal(payload.p_quantita_da_produrre, Math.max(0, 10 - availability));
      return { data: [{ request_id: payload.p_create_request ? "request-1" : null,
        external_id: payload.p_create_request ? "external-1" : null,
        snapshot_id: snapshotIds[index] ?? snapshotIds.at(-1),
        snapshot_captured_at: "2026-08-24T20:00:00Z", reused: index > 0, attempt_count: 0 }], error: null };
    },
  };
}

test("retry della stessa preview riusa lo snapshot senza creare RdP", async () => {
  const admin = fakeAdmin();
  const first = await prepareProductionNetting({ admin, lineId: "line-1" });
  const retry = await prepareProductionNetting({ admin, lineId: "line-1" });
  assert.equal(first.request, null);
  assert.equal(retry.request, null);
  assert.equal(first.snapshot.id, retry.snapshot.id);
  assert.equal(retry.snapshot.reused, true);
  assert.equal(admin.rpcCalls, 2);
});

test("endpoint preview registra solo lo snapshot e non invia o crea RdP", async () => {
  const admin = fakeAdmin();
  let status; let payload;
  await previewProductionRequest({ method: "POST", body: { lineId: "line-1" } }, {
    status(value) { status = value; return { json(value2) { payload = value2; } }; },
  }, { admin });
  assert.equal(status, 200);
  assert.equal(payload.externalId, null);
  assert.equal(payload.sent, false);
  assert.equal(payload.netting.toProduce.value, 6);
  assert.equal(payload.snapshot.sources.availability, "MEXAL_SYNCED_PRODUCT");
  assert.deepEqual(payload.snapshot.blockingReasons, []);
});

test("retry della preparazione invio riusa la stessa RdP e lo stesso snapshot", async () => {
  const admin = fakeAdmin();
  const first = await prepareProductionNetting({ admin, lineId: "line-1", mode: "send" });
  const retry = await prepareProductionNetting({ admin, lineId: "line-1", mode: "send" });
  assert.equal(first.request.id, retry.request.id);
  assert.equal(first.request.external_id, retry.request.external_id);
  assert.equal(first.snapshot.id, retry.snapshot.id);
});

test("articolo non trovato blocca la preview prima dello snapshot", async () => {
  const rows = {
    ordini_righe: { id: "line-1", ordine_id: "order-1", codice_articolo: "MISSING", quantita: 10, unita_misura_oct: "PZ", riga_descrittiva: false },
    ordini_testate: { id: "order-1", origine: "mexal_oct" },
    prodotti: null,
  };
  const admin = {
    from: (table) => query(rows[table]),
    rpc: async () => { throw new Error("RPC non deve essere chiamata"); },
  };
  await assert.rejects(() => prepareProductionNetting({ admin, lineId: "line-1" }), { code: "PRODUCT_NOT_AVAILABLE" });
});

test("snapshot diverso tra preview e rivalidazione segnala disponibilità cambiata", async () => {
  const admin = fakeAdmin({ snapshotIds: [31, 32] });
  const preview = await prepareProductionNetting({ admin, lineId: "line-1" });
  const confirm = await prepareProductionNetting({ admin, lineId: "line-1", mode: "confirm", expectedSnapshotId: preview.snapshot.id });
  assert.equal(confirm.changedFromExpected, true);
});

test("disponibilità cambiata tra invio e conferma blocca la conferma prima di ProgreMES", async () => {
  let reserveCalls = 0;
  let outboundCalls = 0;
  const rows = {
    workspace_production_proposals: { id: 9, production_request_id: "request-1" },
    workspace_production_requests: { id: "request-1", ordine_riga_id: "line-1", sent_availability_snapshot_id: 31,
      sent_quantita_da_produrre: 6, sent_unita_misura: "PZ" },
    ordini_righe: { id: "line-1", ordine_id: "order-1", codice_articolo: "PB0004", quantita: 10, unita_misura_oct: "PZ", riga_descrittiva: false },
    ordini_testate: { id: "order-1", origine: "mexal_oct", mexal_chiave: "OC+2+412" },
    prodotti: { id: "product-1", codice_mexal: "PB0004", disponibilita: 5, sincronizzato_mexal: true, attivo_mexal: true,
      updated_at: "2026-08-24T20:30:00Z", ultimo_sync_mexal: "2026-08-24T20:00:00Z" },
    ordini_prodotti_cache: { codice_articolo: "PB0004", unita_misura: "PZ", sincronizzato_il: "2026-08-24T18:00:00Z" },
  };
  const admin = {
    from: (table) => query(rows[table]),
    rpc: async (name) => {
      if (name === "reserve_workspace_production_confirmation") reserveCalls++;
      return { data: [{ request_id: "request-1", external_id: "external-1", snapshot_id: 32,
        snapshot_captured_at: "2026-08-24T20:31:00Z", reused: false, attempt_count: 1 }], error: null };
    },
  };
  const client = { confirmationEnabled: () => true, confirmProposal: async () => { outboundCalls++; } };
  let status; let payload;
  await confirmProductionProposal({ method: "POST", body: { proposalId: 9 } }, { status(value) { status = value; return { json(value2) { payload = value2; } }; } }, { admin, client });
  assert.equal(status, 409);
  assert.equal(payload.code, "AVAILABILITY_CHANGED");
  assert.equal(reserveCalls, 0);
  assert.equal(outboundCalls, 0);
});

test("riga totalmente coperta non invia alcuna RdP a ProgreMES", async () => {
  const admin = fakeAdmin({ availability: 20, snapshotIds: [41] });
  let outboundCalls = 0;
  const client = { requestEnabled: () => true, sendRequest: async () => { outboundCalls++; throw new Error("non deve essere chiamato"); } };
  let status; let payload;
  await sendProductionRequest({ method: "POST", body: { lineId: "line-1" } }, { status(value) { status = value; return { json(value2) { payload = value2; } }; } }, { admin, client });
  assert.equal(status, 200);
  assert.equal(payload.status, "COPERTA_DA_SCORTA");
  assert.equal(payload.sent, false);
  assert.equal(outboundCalls, 0);
});

test("migration conserva snapshot append-only senza creare RdP in preview, lock prodotto e vincoli non negativi", () => {
  const migration = fs.readFileSync(new URL("../supabase/migrations/20260824220000_phase1_pf_netting_udm.sql", import.meta.url), "utf8");
  assert.match(migration, /workspace_production_availability_snapshots/);
  assert.match(migration, /unique \(ordine_riga_id, snapshot_hash\)/i);
  assert.match(migration, /if p_create_request then\s+insert into public\.workspace_production_requests/is);
  assert.match(migration, /production_request_id uuid references/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /AVAILABILITY_CHANGED/);
  assert.match(migration, /check \(quantita_da_produrre >= 0\)/i);
  assert.match(migration, /sent_availability_snapshot_id is not null then workspace_status/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.(ordini_testate|ordini_righe|prodotti)/i);
});

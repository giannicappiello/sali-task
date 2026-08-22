import test from "node:test";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HMAC_HEADERS, signProductionMessage, verifyProductionMessage } from "./progremes-production-hmac.js";
import { createProductionPayload, createProgremesProductionClient, REQUEST_PATH } from "./progremes-production-client.js";
import { createOctOrdersRunHandler, isOctDocument, normalizeOct } from "./mexal/sync-oct-orders.js";
import { SYNC_TYPES } from "./mexal/lib/syncRuns.js";
import { runRegisteredSync } from "./mexal/lib/syncRegistry.js";
import { SCHEDULE_SYNC_TYPES, EVENT_SYNC_TYPES } from "../src/modules/integrations/services/mexalAutomationService.js";

test("HMAC autentica body e metadati esatti e rifiuta payload alterati", () => {
  const body = Buffer.from('{"schemaVersion":1}');
  const timestamp = 1_800_000_000;
  const signature = signProductionMessage({ method: "POST", path: REQUEST_PATH, timestamp, eventId: "id-1", body, secret: "secret" });
  const headers = { [HMAC_HEADERS.timestamp]: String(timestamp), [HMAC_HEADERS.eventId]: "id-1", [HMAC_HEADERS.signature]: signature };
  assert.equal(verifyProductionMessage({ method: "POST", path: REQUEST_PATH, headers, body, secret: "secret", now: timestamp * 1000 }), true);
  assert.equal(verifyProductionMessage({ method: "POST", path: REQUEST_PATH, headers, body: Buffer.from("{}"), secret: "secret", now: timestamp * 1000 }), false);
});

test("client RdP riusa PROGREMES_URL e PROGREMES_INTEGRATION_SECRET, HTTPS e redirect error", async () => {
  let call;
  const client = createProgremesProductionClient({
    env: { PROGREMES_URL: "https://mes.example.test", PROGREMES_INTEGRATION_SECRET: "server-secret", PROGREMES_PRODUCTION_REQUESTS_ENABLED: "true" },
    now: () => 1_800_000_000_000,
    fetchImpl: async (url, init) => { call = { url: String(url), init }; return { ok: true, json: async () => ({ status: "Ricevuta" }) }; },
  });
  await client.sendRequest({ schemaVersion: 1, externalId: "00000000-0000-4000-8000-000000000001" });
  assert.equal(call.url, `https://mes.example.test${REQUEST_PATH}`);
  assert.equal(call.init.redirect, "error");
  assert.ok(call.init.headers[HMAC_HEADERS.signature]);
  assert.equal("authorization" in call.init.headers, false);
});

test("tutte le mutazioni restano disabilitate se i flag non esistono", () => {
  const client = createProgremesProductionClient({ env: {} });
  assert.equal(client.requestEnabled(), false);
  assert.equal(client.confirmationEnabled(), false);
});

test("OCT usa allow-list OC + modulo configurato ed esclude M X I", () => {
  assert.equal(isOctDocument({ sigla: "OC", cod_modulo: "T" }, { moduleCode: "T" }), true);
  for (const moduleCode of ["M", "X", "I"]) assert.equal(isOctDocument({ sigla: "OC", cod_modulo: moduleCode }, { moduleCode: "T" }), false);
  assert.throws(() => isOctDocument({ sigla: "OC", cod_modulo: "T" }, { moduleCode: "" }));
});

test("normalizzazione OCT conserva PB/FP e righe descrittive senza filtro anagrafico", () => {
  const value = normalizeOct({ sigla: "OC", cod_modulo: "T", serie: 2, numero: 412, cod_conto: "501.00159", data_documento: "2026-08-06",
    righe: [{ id_riga: 1, codice_articolo: "PB0004", quantita: 7000 }, { id_riga: 2, codice_articolo: "FP123", quantita: 1 }, { id_riga: 3, descr_riga: "Nota" }] });
  assert.equal(value.key, "OC+2+412");
  assert.deepEqual(value.lines.map((line) => line.codice_articolo), ["PB0004", "FP123", null]);
  assert.equal(value.lines[2].riga_descrittiva, true);
});

test("run_now/oct_orders è registrato, resta OFF e non importa OCM/OCX/OCI", async () => {
  assert.ok(SYNC_TYPES.includes("oct_orders"));
  assert.ok(SCHEDULE_SYNC_TYPES.includes("oct_orders"));
  assert.equal(EVENT_SYNC_TYPES.includes("oct_orders"), false);

  let runBody;
  await runRegisteredSync({
    syncType: "oct_orders",
    authorization: "Bearer test",
    baseUrl: "https://workspace.test",
    fetchImpl: async (_url, init) => {
      runBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ imported: 0 }) };
    },
  });
  assert.equal(runBody.action, "run_now");
  assert.equal(runBody.syncType, "oct_orders");

  const disabled = createOctOrdersRunHandler({
    createMexalClient: () => { throw new Error("Mexal non deve essere chiamato"); },
    createSupabaseClient: () => { throw new Error("Supabase non deve essere chiamato"); },
    env: {},
  });
  let disabledPayload;
  await disabled({}, { status: () => ({ json: (value) => { disabledPayload = value; } }) });
  assert.deepEqual(disabledPayload, { enabled: false, imported: 0, skipped: 0 });

  const headers = [];
  const lines = [];
  const details = new Map([
    [412, { sigla: "OC", cod_modulo: "T", serie: 2, numero: 412, cod_conto: "C1", righe: [{ id_riga: 1, codice_articolo: "PB1", quantita: 2 }] }],
    [413, { sigla: "OC", cod_modulo: "M", serie: 2, numero: 413, righe: [] }],
    [414, { sigla: "OC", cod_modulo: "X", serie: 2, numero: 414, righe: [] }],
    [415, { sigla: "OC", cod_modulo: "I", serie: 2, numero: 415, righe: [] }],
  ]);
  const supabase = {
    from(table) {
      if (table === "ordini_clienti_cache") {
        const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { codice_cliente: "C1" } }) };
        return chain;
      }
      if (table === "ordini_testate") {
        return { upsert(value) {
          headers.push(value);
          const chain = { select: () => chain, single: async () => ({ data: { id: "ordine-1" }, error: null }) };
          return chain;
        } };
      }
      if (table === "ordini_righe") return { upsert: async (value) => { lines.push(...value); return { error: null }; } };
      throw new Error("Tabella inattesa: " + table);
    },
  };
  const handler = createOctOrdersRunHandler({
    createMexalClient: () => ({
      getJson: async (path) => path === "/oct"
        ? [...details.keys()].map((numero) => ({ sigla: "OC", serie: 2, numero }))
        : details.get(Number(decodeURIComponent(path).split("+").at(-1))),
    }),
    createSupabaseClient: () => supabase,
    env: { MEXAL_OCT_IMPORT_ENABLED: "true", MEXAL_OCT_MODULE_CODE: "T", MEXAL_OCT_LIST_PATH: "/oct" },
  });
  let payload;
  await handler({}, { status: (status) => {
    assert.equal(status, 200);
    return { json: (value) => { payload = value; } };
  } });
  assert.equal(payload.imported, 1);
  assert.equal(payload.skipped, 3);
  assert.equal(headers.length, 1);
  assert.equal(headers[0].mexal_cod_modulo, "T");
  assert.equal(lines.length, 1);
});

test("payload RdP usa UUID stabili e non espone dati tecnici MES", () => {
  const payload = createProductionPayload({ request: { external_id: "r" }, order: { id: "o", mexal_chiave: "OC+2+412", data_ordine: "2026-08-06", mexal_cod_conto: "501.00159" },
    line: { id: "l", codice_articolo: "PB0004", quantita: 7000 } });
  assert.deepEqual(Object.keys(payload), ["schemaVersion", "externalId", "oct", "commercialArticleCode", "quantity", "orderDate", "requestedDeliveryDate", "customerMexalCode"]);
  assert.equal(JSON.stringify(payload).includes("formula"), false);
  assert.equal(JSON.stringify(payload).includes("lotto"), false);
});

test("guard-rail outbound e rewrite evento sono specifici", () => {
  const submit = fs.readFileSync(new URL("../api/mexal/submit-order.js", import.meta.url), "utf8");
  assert.match(submit, /order\?\.origine === "mexal_oct"/);
  const migration = fs.readFileSync(new URL("../supabase/migrations/20260822180300_phase1c0_oct_sync_hardening.sql", import.meta.url), "utf8");
  assert.match(migration, /phase1c0_mexal_oct_outbound_guard_check/);
  assert.match(migration, /stato_sincronizzazione = 'importato_mexal' and sync_token is null/);
  assert.match(migration, /values \('oct_orders', false,/);
  assert.doesNotMatch(migration, /create trigger/i);
  assert.match(migration, /on conflict\(sync_type\) do update set enabled = false/);
  assert.doesNotMatch(migration, /create or replace function/i);
  const baseMigration = fs.readFileSync(new URL("../supabase/migrations/20260822180000_phase1c0_oct_production_flow.sql", import.meta.url), "utf8");
  assert.doesNotMatch(baseMigration, /drop trigger if exists/i);
  assert.doesNotMatch(baseMigration, /impedisci_reinvio_mexal_oct/);
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(vercel.rewrites.some((item) => item.source === "/api/progremes-production/events"));
  assert.ok(vercel.rewrites.some((item) => item.source === "/api/progremes/:resource"));
});

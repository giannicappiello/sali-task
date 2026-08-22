import test from "node:test";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HMAC_HEADERS, signProductionMessage, verifyProductionMessage } from "./progremes-production-hmac.js";
import { createProductionPayload, createProgremesProductionClient, REQUEST_PATH } from "./progremes-production-client.js";
import { isOctDocument, normalizeOct } from "./mexal/sync-oct-orders.js";

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
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(vercel.rewrites.some((item) => item.source === "/api/progremes-production/events"));
  assert.ok(vercel.rewrites.some((item) => item.source === "/api/progremes/:resource"));
});

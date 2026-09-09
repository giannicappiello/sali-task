import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareOrderVat } from "./order-vat.js";
import { buildRootMatrixRows } from "./order-documents.js";

test("recupera IVA mancante da Mexal e conserva posizione e quantità del documento", async () => {
  const lines = [
    { id: "a", codice_articolo: "IT0099", codice_iva_mexal: "22,0", quantita_documento: 12 },
    { id: "b", codice_articolo: "IT0092", codice_iva_mexal: "22,0", quantita_documento: 12 },
    { id: "c", codice_articolo: "IT0542-CMP", descrizione: "TESTER Home Parfum Ambra & Legni", quantita_documento: 2 },
  ];
  const requested = [];
  const result = await prepareOrderVat({ OCM: lines }, {}, { loadArticle: async (_mexal, code) => {
    requested.push(code); return { codice: code, alq_iva: " 22,0 " };
  } });
  assert.deepEqual(requested, ["IT0542-CMP"]);
  assert.deepEqual(result.updates, [{ id: "c", codice_iva_mexal: "22,0", aliquota_iva: 22 }]);
  const payload = buildRootMatrixRows(result.documents.OCM, 5, null, "OCM");
  assert.deepEqual(payload.cod_iva, [[1, "22,0"], [2, "22,0"], [3, "22,0"]]);
  assert.deepEqual(payload.quantita, [[1, 12], [2, 12], [3, 2]]);
  assert.equal(lines[2].codice_iva_mexal, undefined, "non muta l'input");
});

test("recupero unico per articolo anche suddiviso OCM/OCX", async () => {
  let calls = 0;
  const line = { id: "a", codice_articolo: "IT1", cod_iva: "  " };
  const result = await prepareOrderVat({ OCM: [line], OCX: [line], OCI: [] }, {}, {
    loadArticle: async () => { calls++; return { codice: "IT1", alq_iva: "10,0" }; },
  });
  assert.equal(calls, 1);
  assert.equal(result.updates.length, 1);
  assert.equal(result.documents.OCX[0].cod_iva, "10,0");
});

test("conserva snapshot validi inclusa IVA zero, senza default al 22%", async () => {
  const result = await prepareOrderVat({ OCI: [{ codice_articolo: "IT1", cod_iva: " ", codice_iva_mexal: "0" }] }, {}, {
    loadArticle: async () => { assert.fail("non rilegge snapshot valido"); },
  });
  assert.equal(result.documents.OCI[0].cod_iva, "0");
  assert.deepEqual(result.updates, []);
  assert.deepEqual(buildRootMatrixRows([{ cod_iva: " ", codice_iva_mexal: "22,0" }], 5).cod_iva, [[1, "22,0"]]);
});

test("preflight blocca IVA assente, articolo non corrispondente o errore rete indicando articolo e riga", async () => {
  const documents = { OCI: [{ codice_articolo: "IT0542-CMP", descrizione: "Tester" }] };
  for (const article of [{ codice: "IT0542-CMP" }, { codice: "ALTRO", alq_iva: "22,0" }, null]) {
    await assert.rejects(prepareOrderVat(documents, {}, { loadArticle: async () => article }), /OCI, riga 1: IT0542-CMP.*Nessun nuovo documento/);
  }
  await assert.rejects(prepareOrderVat(documents, {}, { loadArticle: async () => { throw new Error("timeout"); } }), /IVA non verificabile.*IT0542-CMP/);
});

test("il recupero di ordini grandi rispetta il limite di concorrenza", async () => {
  let active = 0; let peak = 0;
  const result = await prepareOrderVat({ OCM: Array.from({ length: 20 }, (_, i) => ({ codice_articolo: `IT${i}` })) }, {}, {
    loadArticle: async (_mexal, code) => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 1)); active--; return { codice: code, alq_iva: "22,0" }; },
  });
  assert.ok(peak <= 6 && peak > 1);
  assert.equal(result.documents.OCM.length, 20);
});

test("salvataggio conserva snapshot IVA ed economia, riparazione atomica limitata al sync attivo", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260909130000_order_vat_snapshot_repair.sql", import.meta.url), "utf8");
  for (const field of ["codice_iva_mexal", "aliquota_iva", "imponibile_riga", "iva_riga"]) {
    assert.match(sql, new RegExp(`r\\.${field}`));
  }
  assert.match(sql, /sync_token = p_sync_token/);
  assert.match(sql, /count\(distinct r.id\)/);
  assert.match(sql, /v_count <> jsonb_array_length/);
  assert.match(sql, /nullif\(btrim\(r.codice_iva_mexal\), ''\) is null/);
  assert.match(sql, /from public, anon, authenticated/);
  const handler = readFileSync(new URL("../../api/mexal/submit-order.js", import.meta.url), "utf8");
  assert.ok(handler.indexOf("await prepareOrderVat") < handler.indexOf("await mexal.postJson"));
  assert.match(handler, /filter\(\(\[kind\]\) => !done.has\(kind\)\)/);
});

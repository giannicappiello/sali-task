import test from "node:test";
import assert from "node:assert/strict";
import { MES_FORMULA_UNIT, MEXAL_V3_CONTRACT, normalizeFinishedBomRows, normalizeSupplierOrders } from "./sync-workspacemes-v3.js";

const articles = new Map([
  ["DR-BC07", { codice_articolo: "DR-BC07", descrizione: "Crema", dati_mexal: { um_principale: "PZ" } }],
  ["FP041C", { codice_articolo: "FP041C", descrizione: "Formula", dati_mexal: { um_principale: "KG" } }],
  ["AS100", { codice_articolo: "AS100", descrizione: "Astuccio", dati_mexal: { um_principale: "PZ" } }],
]);

test("contratto DB reale riusa endpoint e campi ProgreMES e classifica FP senza perdere DIRECT", () => {
  assert.equal(MEXAL_V3_CONTRACT.finishedBom, "/distinte-base/componenti/ricerca");
  const boms = normalizeFinishedBomRows([
    { codice: "DR-BC07", codice_mp: "FP041C", qta_utilizzo: "0,2", nr_unita_misura: "1" },
    { codice: "DR-BC07", codice_mp: "AS100", qta_utilizzo: 1, nr_unita_misura: "1" },
  ], articles);
  assert.deepEqual(boms.get("DR-BC07").map((row) => [row.articleCode, row.quantity, row.unitOfMeasure, row.componentKind]), [
    ["AS100", 1, "PZ", "DIRECT_COMPONENT"],
    ["FP041C", 0.2, MES_FORMULA_UNIT, "FORMULA_COMPONENT"],
  ]);
});

test("gli FP sono riferimenti formula MES e non dipendono dalla cache articoli Mexal", () => {
  const withoutFpArticle = new Map([...articles].filter(([code]) => code !== "FP041C"));
  const boms = normalizeFinishedBomRows([
    { codice: "DR-BC07", codice_mp: "FP041C", qta_utilizzo: "0,2", nr_unita_misura: "1" },
  ], withoutFpArticle);
  const formula = boms.get("DR-BC07")[0];
  assert.equal(formula.articleCode, "FP041C");
  assert.equal(formula.formulaExternalRef, "FP041C");
  assert.equal(formula.unitOfMeasure, MES_FORMULA_UNIT);
  assert.equal(formula.componentKind, "FORMULA_COMPONENT");
});

test("i componenti DIRECT restano fail-closed senza UDM Mexal certificata", () => {
  const withoutDirectArticle = new Map([...articles].filter(([code]) => code !== "AS100"));
  assert.throws(() => normalizeFinishedBomRows([
    { codice: "DR-BC07", codice_mp: "AS100", qta_utilizzo: 1, nr_unita_misura: "1" },
  ], withoutDirectArticle), (error) => error.code === "MEXAL_PRIMARY_UOM_MISSING");
});

test("UDM distinta diversa dalla primaria blocca senza inventare conversioni", () => {
  assert.throws(() => normalizeFinishedBomRows([
    { codice: "DR-BC07", codice_mp: "AS100", qta_utilizzo: 1, nr_unita_misura: "2" },
  ], articles), (error) => error.code === "MEXAL_BOM_UOM_UNCERTIFIED");
});

test("articoli disattivati da Mexal bloccano distinta e forniture", () => {
  const inactive = new Map(articles);
  inactive.set("AS100", { ...inactive.get("AS100"), activeMexal: false });
  assert.throws(() => normalizeFinishedBomRows([
    { codice: "DR-BC07", codice_mp: "AS100", qta_utilizzo: 1, nr_unita_misura: "1" },
  ], inactive), (error) => error.code === "MEXAL_ARTICLE_INACTIVE");
});

test("ordini fornitore conservano chiavi reali, scadenza riga e ricevuto non esposto", () => {
  const rows = normalizeSupplierOrders({
    headers: [{ sigla: "OF", serie: "1", numero: "42", cod_conto: "201.00001", data_documento: "28/08/2026" }],
    lines: [{ sigla: "OF", serie: "1", numero: "42", codice_articolo: "AS100", quantita: "100,000", dt_sca_riga: "30/08/2026" }],
    articlesByCode: articles,
    suppliersByCode: new Map([["201.00001", { ragione_sociale: "Fornitore reale" }]]),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].order_external_key, "OF/1/42");
  assert.equal(rows[0].article_code, "AS100");
  assert.equal(rows[0].ordered_quantity, 100);
  assert.equal(rows[0].unit_of_measure, "PZ");
  assert.equal(rows[0].expected_at, "2026-08-30T00:00:00.000Z");
  assert.equal(MEXAL_V3_CONTRACT.receiptSemantics, "NOT_EXPOSED_BY_MEXAL_ENDPOINT");
});

test("la sincronizzazione preview può essere limitata agli articoli finiti della RdP", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("./sync-workspacemes-v3.js", import.meta.url), "utf8"));
  assert.match(source, /finishedArticleCodes = null/);
  assert.match(source, /includeSupplierOrders = true/);
  assert.match(source, /if \(!includeSupplierOrders\)/);
  assert.match(source, /targetFinishedCodes\.has\(upper\(row\.codice\)\)/);
  assert.match(source, /relevantComponents\.has\(upper\(row\.codice_articolo\)\)/);
});

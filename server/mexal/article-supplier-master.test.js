import test from "node:test";
import assert from "node:assert/strict";
import { extractArticleMasterSuppliers, readMexalArticleSupplierMaster } from "./article-supplier-master.js";

test("legge tutti i fornitori configurati nel menu dell'anagrafica articolo Mexal", () => {
  assert.deepEqual(extractArticleMasterSuppliers({
    cod_fornitore: [[2, "601.00411"], [1, "601.00022"], [3, "601.00411"], [5, ""]],
  }), [
    { position: 1, supplierCode: "601.00022" },
    { position: 2, supplierCode: "601.00411" },
  ]);
});

test("pagina l'anagrafica articoli e produce le associazioni senza usare gli ordini", async () => {
  const calls = [];
  const mexal = { getJson: async (path) => {
    calls.push(path);
    if (calls.length === 1) return { dati: [
      { codice: "MP0001", cod_fornitore: [[1, "601.00001"], [2, "601.00002"]] },
      { codice: "MP0002", cod_fornitore: [] },
    ], next: "pagina-2" };
    return { dati: [{ codice: "CN0001", cod_fornitore: [[1, "601.00003"]] }] };
  } };
  const result = await readMexalArticleSupplierMaster(mexal, { pageSize: 2 });
  assert.deepEqual(result, [
    { articleCode: "MP0001", supplierCode: "601.00001", priority: 1 },
    { articleCode: "MP0001", supplierCode: "601.00002", priority: 2 },
    { articleCode: "CN0001", supplierCode: "601.00003", priority: 1 },
  ]);
  assert.match(calls[0], /^\/articoli\?/);
  assert.match(calls[0], /fields=codice%2Ccod_fornitore/);
  assert.match(calls[1], /next=pagina-2/);
});

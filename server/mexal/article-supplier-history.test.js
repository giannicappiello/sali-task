import assert from "node:assert/strict";
import test from "node:test";
import { readMexalArticleSupplierHistory } from "./sync-workspacemes-v3.js";

test("lo storico Mexal deduplica articolo-fornitore e conserva frequenza e data più recente", async () => {
  const payloads = new Map([
    ["/documenti/ordini-fornitori", { dati: [
      { sigla: "PF", serie: "1", numero: "10", cod_conto: "F001", data_documento: "01/08/2026" },
      { sigla: "PF", serie: "1", numero: "11", cod_conto: "F001", data_documento: "15/08/2026" },
      { sigla: "PF", serie: "1", numero: "12", cod_conto: "F002", data_documento: "10/08/2026" },
    ] }],
    ["/documenti/ordini-fornitori/righe", { dati: [
      { sigla: "PF", serie: "1", numero: "10", codice_articolo: "mp01" },
      { sigla: "PF", serie: "1", numero: "11", codice_articolo: "MP01" },
      { sigla: "PF", serie: "1", numero: "12", codice_articolo: "MP01" },
    ] }],
  ]);
  const mexal = { async getJson(url) { return payloads.get(url.split("?")[0]); } };
  const rows = await readMexalArticleSupplierHistory(mexal);
  assert.deepEqual(rows, [
    { articleCode: "MP01", supplierCode: "F001", orderCount: 2, lastOrderAt: "2026-08-15" },
    { articleCode: "MP01", supplierCode: "F002", orderCount: 1, lastOrderAt: "2026-08-10" },
  ]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderPdfModel, createOrderPdf } from "../src/modules/orders/services/orderPdf.js";

test("il modello PDF usa il motore economico condiviso per quindici righe", () => {
  const lines = Array.from({ length: 15 }, (_, index) => ({ codice_articolo: `A-${index}`, quantita: 2, prezzo_listino: 10, sconto_commerciale: "10", aliquota_iva: 22 }));
  const model = buildOrderPdfModel({ numero_ocm: "OCM-1", numero_oci: "OCI-1" }, lines);
  assert.equal(model.lines.length, 15);
  assert.equal(model.totals.totale_imponibile, 270);
  assert.equal(model.totals.totale_iva, 59.4);
  assert.equal(model.totals.totale_documento, 329.4);
  assert.equal(model.vat.length, 1);
  assert.deepEqual(model.documents, ["OCM-1", "OCI-1"]);
});

test("il PDF con almeno quindici righe gestisce più pagine e intestazioni", async () => {
  const lines = Array.from({ length: 45 }, (_, index) => ({ codice_articolo: `A-${index}`, descrizione: `Articolo molto descrittivo ${index}`, quantita: 1, prezzo_listino: 10, aliquota_iva: 22 }));
  const pdf = await createOrderPdf({ id: "ordine-test", data_ordine: "2026-07-20" }, lines, { logo: false });
  assert.ok(pdf.internal.getNumberOfPages() > 1);
  assert.match(pdf.output(), /Codice/);
});

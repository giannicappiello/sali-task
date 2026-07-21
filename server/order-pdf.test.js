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
  const output = pdf.output();
  assert.match(output, /ARTICOLO/);
  assert.match(output, /FIRMA VETTORE/);
  assert.match(output, /TOTALE DA PAGARE/);
});

test("il layout usa il listino nell'importo e non inventa dati logistici", async () => {
  const order = { id: "ordine-listino", data_ordine: "2026-07-20", commenti: "Consegna mattina" };
  const lines = [{ codice_articolo: "A-1", quantita: 2, prezzo_listino: 100, sconto_commerciale: "50+35+5", aliquota_iva: 22 }];
  const model = buildOrderPdfModel(order, lines);
  assert.equal(model.totale_merce, 200);
  assert.equal(model.totals.totale_imponibile, 61.75);
  const pdf = await createOrderPdf(order, lines, { logo: false });
  const output = pdf.output();
  assert.match(output, /200,00/);
  assert.match(output, /50\+35/);
  assert.match(output, /\+5/);
  assert.match(output, /22/);
  assert.doesNotMatch(output, /a cura del vettore \/ come da accordi/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { invoiceLines, isRequestedSalesDocument } from "./invoice-line-economics.js";
import { warehouseReasonDescription } from "../../shared/mexalWarehouseReasons.js";

test("accetta tutte le varianti FT e i documenti OCX/COX", () => {
  assert.equal(isRequestedSalesDocument({ sigla: "FT", cod_modulo: "E" }), true);
  assert.equal(isRequestedSalesDocument({ sigla: "FT", cod_modulo: "A" }), true);
  assert.equal(isRequestedSalesDocument({ sigla: "FT", cod_modulo: "0" }), true);
  assert.equal(isRequestedSalesDocument({ sigla: "OC", cod_modulo: "X" }), true);
  assert.equal(isRequestedSalesDocument({ sigla: "CO", cod_modulo: "X" }), true);
  assert.equal(isRequestedSalesDocument({ sigla: "OC", cod_modulo: "M" }), false);
});

test("mantiene righe grezze anche senza codice articolo o id_riga", () => {
  const lines = invoiceLines({
    descr_articolo: [[1, "Riga descrittiva"], [2, "Articolo senza codice"]],
    quantita: [[2, 1]],
    prezzo: [[2, 0]],
    cod_iva: [[2, 0]],
  });
  assert.equal(lines.length, 2);
  assert.equal(lines[0].codice_articolo, null);
  assert.equal(lines[1].prezzo_unitario, 0);
  assert.equal(lines[1].aliquota_iva, 0);
});

test("traduce le causali Mexal nelle descrizioni aziendali definitive", () => {
  assert.equal(warehouseReasonDescription(1), "Vendita diretta");
  assert.equal(warehouseReasonDescription([[1, 2]]), "Vendita Online");
  assert.equal(warehouseReasonDescription("3"), "Vendita C/Terzi");
  assert.equal(warehouseReasonDescription(10), "Campionatura");
  assert.equal(warehouseReasonDescription(99, "Causale personalizzata"), "Causale personalizzata");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  applySequentialDiscounts,
  calculateOrderEconomics,
  reconcileMexalTotals,
} from "./order-economics.js";
import { buildMexalOrderDocument, normalizeMexalUnitType } from "./order-documents.js";

test("applica gli sconti commerciali in sequenza", () => {
  assert.equal(applySequentialDiscounts(4.6, "50+35"), 1.4949999999999999);
});

test("calcola gli stessi totali del documento Mexal di riferimento", () => {
  const totals = calculateOrderEconomics([{
    codice_articolo: "IT0001",
    quantita_documento: 1,
    prezzo_listino: 4.6,
    sconto_commerciale: "50+35",
    aliquota_iva: 22,
  }]);

  assert.equal(totals.totale_imponibile, 1.5);
  assert.equal(totals.totale_iva, 0.33);
  assert.equal(totals.totale_documento, 1.83);
  assert.equal(reconcileMexalTotals(totals, {
    tot_iva: [[1, 0.33]],
    tot_documento: [[1, 1.83]],
  }).coincide, true);
});

test("normalizza il codice unità di misura Mexal come stringa", () => {
  assert.equal(normalizeMexalUnitType(undefined), "PZ");
  assert.equal(normalizeMexalUnitType(" pz "), "PZ");
  assert.equal(normalizeMexalUnitType("CF"), "CF");
  assert.equal(normalizeMexalUnitType("1"), "1");
  assert.equal(normalizeMexalUnitType(2), "2");
});

test("il payload usa data YYYYMMDD, prezzo di listino, codice IVA e unità reale", () => {
  const payload = buildMexalOrderDocument({
    id: "ordine-1",
    codice_cliente: "501.03320",
    data_ordine: "2026-07-20",
    codice_agente_mexal: "602.00047",
  }, "OCM", [{
    codice_articolo: "IT0001",
    quantita_documento: 1,
    prezzo_listino: 4.6,
    prezzo_netto: 1.495,
    sconto_commerciale: "50+35",
    codice_iva_mexal: " 22,0",
    unita_misura: "PZ",
  }]);

  assert.equal(payload.data_documento, "20260720");
  assert.deepEqual(payload.prezzo, [[1, 4.6]]);
  assert.deepEqual(payload.sconto, [[1, "50+35"]]);
  assert.deepEqual(payload.cod_iva, [[1, "22,0"]]);
  assert.deepEqual(payload.tp_um_articolo, [[1, "PZ"]]);
});

test("tp_um_articolo esplicito ha precedenza sull'unità di misura", () => {
  const payload = buildMexalOrderDocument({
    id: "ordine-2",
    codice_cliente: "501.03320",
    data_ordine: "2026-07-20",
    codice_agente_mexal: "602.00047",
  }, "OCM", [{
    codice_articolo: "IT0001",
    quantita_documento: 1,
    prezzo_listino: 4.6,
    unita_misura: "PZ",
    tp_um_articolo: "CF",
  }]);

  assert.deepEqual(payload.tp_um_articolo, [[1, "CF"]]);
});

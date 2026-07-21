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
  assert.equal(normalizeMexalUnitType(undefined), "1");
  assert.equal(normalizeMexalUnitType(" pz "), "pz");
  assert.equal(normalizeMexalUnitType("CF"), "CF");
  assert.equal(normalizeMexalUnitType("1"), "1");
  assert.equal(normalizeMexalUnitType(2), "2");
});

test("una riga IT0001 usa la struttura rilevata nel documento Mexal reale", () => {
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
    cod_iva: "22,0",
    unita_misura: "PZ",
  }], { magazzino: 5, dateFormat: "yyyymmdd" });

  assert.equal(payload.data_documento, "20260720");
  assert.deepEqual({ id_riga: payload.id_riga, tp_riga: payload.tp_riga, codice_articolo: payload.codice_articolo, tp_um_articolo: payload.tp_um_articolo, quantita: payload.quantita, prezzo: payload.prezzo, sconto: payload.sconto, cod_iva: payload.cod_iva, id_mag_riga: payload.id_mag_riga }, {
    id_riga: [[1, 1]], tp_riga: [[1, "R"]], codice_articolo: [[1, "IT0001"]], tp_um_articolo: [[1, "1"]], quantita: [[1, 1]], prezzo: [[1, 4.6]], sconto: [[1, "50+35"]], cod_iva: [[1, "22,0"]], id_mag_riga: [[1, 5]],
  });
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

test("id_causale non viene inviato come scalare senza un contratto POST verificato", () => {
  const payload = buildMexalOrderDocument({ id: "ordine-3", codice_cliente: "501.03320", data_ordine: "2026-07-20", id_causale: 1 }, "OCM", [{ codice_articolo: "IT0001", quantita_documento: 1 }]);
  assert.equal(Object.hasOwn(payload, "id_causale"), false);
});

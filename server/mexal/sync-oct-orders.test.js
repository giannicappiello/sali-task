import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeOct } from "./sync-oct-orders.js";

const oct2412 = JSON.parse(fs.readFileSync(
  new URL("./fixtures/oct-2-412.parallel.json", import.meta.url),
  "utf8",
));

test("OCT 2/412 ricostruisce testata e matrici di riga sparse per indice", () => {
  const normalized = normalizeOct(oct2412);

  assert.equal(normalized.key, "OC+2+412");
  assert.deepEqual(
    {
      sigla: normalized.header.mexal_sigla,
      modulo: normalized.header.mexal_cod_modulo,
      serie: normalized.header.mexal_serie,
      numero: normalized.header.mexal_numero,
      cliente: normalized.header.codice_cliente,
      dataOrdine: normalized.header.data_ordine,
    },
    { sigla: "OC", modulo: "T", serie: 2, numero: 412, cliente: "501.00159", dataOrdine: "2026-08-06" },
  );
  assert.equal(normalized.lines.length, 3);
  assert.deepEqual(normalized.lines.map((line) => line.mexal_posizione), [1, 2, 3]);
  assert.deepEqual(normalized.lines.map((line) => line.mexal_tipo_riga), ["R", "D", "D"]);
  assert.deepEqual(normalized.lines.map((line) => line.codice_articolo), ["PB0004", null, null]);
  assert.deepEqual(normalized.lines.map((line) => line.descrizione), ["", "Prima nota descrittiva", "Seconda nota descrittiva"]);
  assert.deepEqual(normalized.lines.map((line) => line.quantita), [7000, 0, 0]);
  assert.deepEqual(normalized.lines.map((line) => line.riga_descrittiva), [false, true, true]);
  assert.equal(normalized.lines[0].data_consegna, "2026-09-15");
});

test("formato legacy righe[] resta supportato incluso dt_sca_riga", () => {
  const normalized = normalizeOct({
    sigla: "OC",
    cod_modulo: "T",
    serie: 2,
    numero: 413,
    data_documento: "2026-08-07",
    righe: [
      { id_riga: 10, tp_riga: "R", codice_articolo: "FP123", descr_riga: "Articolo legacy", quantita: 2, dt_sca_riga: "2026-09-20" },
      { id_riga: 20, tp_riga: "D", descr_riga: "Nota legacy" },
    ],
  });

  assert.deepEqual(normalized.lines, [
    {
      mexal_posizione: 10,
      codice_articolo: "FP123",
      descrizione: "Articolo legacy",
      quantita: 2,
      data_consegna: "2026-09-20",
      mexal_tipo_riga: "R",
      riga_descrittiva: false,
    },
    {
      mexal_posizione: 20,
      codice_articolo: null,
      descrizione: "Nota legacy",
      quantita: 0,
      data_consegna: null,
      mexal_tipo_riga: "D",
      riga_descrittiva: true,
    },
  ]);
});

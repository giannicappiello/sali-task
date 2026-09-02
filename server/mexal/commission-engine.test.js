import test from "node:test";
import assert from "node:assert/strict";
import { calculateCommissions } from "./commission-engine.js";

const order = { codice_agente_mexal: "A01" };
const customer = { codice_cliente: "C01", categoria_provvigionale_mexal: 10 };

test("un articolo senza categoria provvigionale non blocca l'ordine", () => {
  const [line] = calculateCommissions({
    order,
    customer,
    lines: [{ id: "r1", codice_articolo: "ART-1", quantita: 1 }],
    products: [{ codice_articolo: "ART-1" }],
    rules: [],
  });

  assert.equal(line.provvigione_percentuale, null);
  assert.equal(line.provvigione_regola_id, null);
  assert.equal(line.provvigione_dettaglio_calcolo.applicata, false);
});

test("l'assenza di una regola per l'articolo non blocca l'ordine", () => {
  const [line] = calculateCommissions({
    order,
    customer,
    lines: [{ id: "r1", codice_articolo: "ART-1", quantita: 1 }],
    products: [{ codice_articolo: "ART-1", categoria_provvigionale_mexal: 20 }],
    rules: [],
  });

  assert.equal(line.provvigione_percentuale, null);
  assert.match(line.provvigione_dettaglio_calcolo.motivo, /nessuna regola/i);
});

test("una regola valida continua a calcolare la provvigione", () => {
  const [line] = calculateCommissions({
    order,
    customer,
    lines: [{ id: "r1", codice_articolo: "ART-1", quantita: 1 }],
    products: [{ codice_articolo: "ART-1", categoria_provvigionale_mexal: 20 }],
    rules: [{ id: "regola-1", attiva: true, categoria_cliente: 10, categoria_prodotto: 20, percentuale: 7.5 }],
  });

  assert.equal(line.provvigione_percentuale, 7.5);
  assert.equal(line.provvigione_regola_id, "regola-1");
});

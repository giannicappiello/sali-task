import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mapClient } from "./sync-clients.js";

const source = readFileSync(new URL("./sync-clients.js", import.meta.url), "utf8");

test("la sync clienti importa solo anagrafiche Mexal attive", () => {
  assert.match(source, /if \(!mapped\.attivo_mexal\) continue/);
  assert.match(source, /attivo_mexal: isMexalClientActive\(client\)/);
  assert.match(source, /missingCodes/);
  assert.match(source, /attivo_mexal: false/);
});

test("la sync salva i campi di classificazione Mexal", () => {
  assert.match(source, /cod_alternativo:/);
  assert.match(source, /"cod_alternativo", "codice_alternativo"/);
  assert.match(source, /nome_ricerca_cf:/);
  assert.match(source, /"nome_ricerca_cf", "nome_ricerca"/);
});

test("la sync salva per tutti i clienti la categoria statistica reale Mexal", () => {
  const mapped = mapClient(
    { codice: "501.00288", ragione_sociale: "MyPharma Srl", cod_cat_sta: 2 },
    "2026-09-14T00:00:00.000Z",
    new Map(),
  );
  assert.equal(mapped.categoria_statistica_cliente, 2);
  assert.equal(mapped.dati_mexal.cod_cat_sta, 2);
});

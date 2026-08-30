import assert from "node:assert/strict";
import test from "node:test";
import { clientCountryCode, normalizeCountryCode } from "./sync-clients.js";

test("normalizza i codici italiani restituiti da Mexal", () => {
  for (const value of ["IT", "ita", "Italia", "ITALY", 380]) {
    assert.equal(normalizeCountryCode(value), "IT");
  }
});

test("legge Paese da matrici e blocchi anagrafici Mexal", () => {
  assert.equal(clientCountryCode({ cod_paese: [[1, "FR"]] }), "FR");
  assert.equal(clientCountryCode({ anagrafica: { codice_nazione: "DE" } }), "DE");
  assert.equal(clientCountryCode({ dati_fiscali: { country_code: "ES" } }), "ES");
});

test("non inventa una nazionalità quando Mexal non la espone", () => {
  assert.equal(clientCountryCode({ ragione_sociale: "Cliente senza Paese" }), null);
});

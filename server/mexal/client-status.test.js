import test from "node:test";
import assert from "node:assert/strict";

import { isMexalClientActive } from "./client-status.js";

test("conto_precanc S rende inattivo un cliente Mexal", () => {
  assert.equal(isMexalClientActive({ conto_precanc: "S" }), false);
});

test("conto_precanc N mantiene attivo un cliente Mexal", () => {
  assert.equal(isMexalClientActive({ conto_precanc: "N" }), true);
});

test("conto_precanc prevale sui fallback storici", () => {
  assert.equal(isMexalClientActive({ conto_precanc: "S", gest_annullato: "N" }), false);
  assert.equal(isMexalClientActive({ conto_precanc: "N", gest_annullato: "S" }), true);
});

test("mantiene la compatibilita con i flag di annullamento storici", () => {
  for (const field of ["gest_annullato", "annullato", "precancellato"]) {
    assert.equal(isMexalClientActive({ [field]: "S" }), false, field);
  }
});

test("normalizza i valori booleani e numerici gia supportati", () => {
  assert.equal(isMexalClientActive({ conto_precanc: true }), false);
  assert.equal(isMexalClientActive({ conto_precanc: 1 }), false);
  assert.equal(isMexalClientActive({ conto_precanc: false }), true);
  assert.equal(isMexalClientActive({}), true);
});

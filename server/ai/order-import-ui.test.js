import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../src/modules/orders/pages/AIOrderImport.jsx", import.meta.url), "utf8");

test("preview ordine mostra dati estratti, stato, confidence, motivazione e alternative", () => {
  assert.match(source, /Testo letto:/);
  assert.match(source, /Codice:.*EAN:/s);
  assert.match(source, /productMatch\?\.confidence/);
  assert.match(source, /productMatch\?\.reason/);
  assert.match(source, /ai-match-alternatives/);
  assert.match(source, /Proposto:/);
});

test("probable e ambiguous non vengono auto-selezionati", () => {
  assert.match(source, /productMatch\?\.status === "matched"/);
  assert.doesNotMatch(source, /\["matched",\s*"probable"\]/);
  assert.match(source, /Conferma esplicitamente uno dei candidati/);
});

test("UI supporta Excel multi-foglio e preview di ordini distinti", () => {
  assert.match(source, /\.xlsx,\.xls,\.xlsm/);
  assert.match(source, /Fogli analizzati/);
  assert.match(source, /Ordini distinti nel workbook/);
  assert.match(source, /sheetName/);
  assert.match(source, /rowNumber/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("le righe scartate sono visibili e stampabili", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("./PurchaseRequirements.jsx", import.meta.url), "utf8"),
    readFile(new URL("./production.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /result\.discardedRows/);
  assert.match(source, /Righe scartate nell’ultima importazione/);
  assert.match(source, /Tipo riga/);
  assert.match(source, /Descrizione Mexal/);
  assert.match(source, /row\.rowType/);
  assert.match(source, /Stampa elenco/);
  assert.match(source, /printDiscardedRows/);
  assert.match(source, /row\.orderReference/);
  assert.match(source, /row\.articleCode/);
  assert.match(source, /row\.description/);
  assert.match(source, /row\.reason/);
  assert.match(css, /\.purchase-discarded/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("messaggi rimossi dalla UI Nuovo Ordine", async () => {
  const source = await readFile(new URL("../src/modules/orders/pages/NewOrder.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /La nota Mexal sarà generata automaticamente dopo il primo salvataggio/);
  assert.doesNotMatch(source, /Regole caricate: matrice/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("messaggi rimossi dalla UI Nuovo Ordine", async () => {
  const source = await readFile(new URL("../src/modules/orders/pages/NewOrder.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /La nota Mexal sarà generata automaticamente dopo il primo salvataggio/);
  assert.doesNotMatch(source, /Regole caricate: matrice/);
});

test("il selettore distingue articoli Mexal e impianti locali", async () => {
  const source = await readFile(new URL("../src/modules/orders/pages/NewOrder.jsx", import.meta.url), "utf8");
  assert.match(source, /key=\{productOptionKey\(product\)\}/);
  assert.match(source, /productOptionTypeLabel\(product\)/);
  assert.match(source, /findMexalProductByCode\(products, line\.codice_articolo\)/);
});

test("il click su un prodotto prepara una quantità selezionabile e chiude la ricerca rapida", async () => {
  const source = await readFile(new URL("../src/modules/orders/pages/NewOrder.jsx", import.meta.url), "utf8");
  assert.match(source, /setPendingProduct\(product\)/);
  assert.match(source, /setPendingQuantity\("1"\)/);
  assert.match(source, /setProductSearch\(""\)/);
  assert.match(source, /productQuantityRef\.current\?\.select\(\)/);
});

test("il riepilogo disponibilità elenca codice descrizione e quantità dei prodotti OCX", async () => {
  const source = await readFile(new URL("../src/modules/orders/pages/NewOrder.jsx", import.meta.url), "utf8");
  assert.match(source, /<OcxProductSummary items=\{availabilityPreview\.ocx\}/);
  assert.match(source, /item\.productCode/);
  assert.match(source, /item\.description/);
  assert.match(source, /pieces\(item\.quantity\)/);
});

test("Nuovo e Modifica ordine usano la testata Workspace con ritorno all'elenco", async () => {
  const [layout, css] = await Promise.all([
    readFile(new URL("../src/components/WorkspaceScreenLayout.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/orders/orders-module.css", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /modifica\\\/\|elenco\\\//);
  assert.match(layout, /path: `\$\{basePath\}\/elenco`/);
  assert.match(css, /\.orders-new-order-page\{position:relative/);
  assert.doesNotMatch(css, /\.orders-new-order-page\{position:fixed/);
});

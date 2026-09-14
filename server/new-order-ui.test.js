import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("messaggi rimossi dalla UI Nuovo Ordine", async () => {
  const source = await readFile(new URL("../src/modules/orders/pages/NewOrder.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /La nota Mexal sarà generata automaticamente dopo il primo salvataggio/);
  assert.doesNotMatch(source, /Regole caricate: matrice/);
});

test("il selettore distingue gli impianti, ordina per codice e non mostra Articolo Mexal", async () => {
  const source = await readFile(new URL("../src/modules/orders/pages/NewOrder.jsx", import.meta.url), "utf8");
  assert.match(source, /key=\{productOptionKey\(product\)\}/);
  assert.match(source, /\.localeCompare\(/);
  assert.match(source, /numeric: true, sensitivity: "base"/);
  assert.match(source, /Impianto locale/);
  assert.doesNotMatch(source, /Articolo Mexal/i);
  assert.doesNotMatch(source, /Entità:/);
  assert.match(source, /findMexalProductByCode\(products, line\.codice_articolo\)/);
});

test("la posizione visuale delle righe viene salvata e riutilizzata verso Mexal", async () => {
  const [form, submit] = await Promise.all([
    readFile(new URL("../src/modules/orders/pages/NewOrder.jsx", import.meta.url), "utf8"),
    readFile(new URL("../api/mexal/submit-order.js", import.meta.url), "utf8"),
  ]);
  assert.match(form, /lines\.map\(\(line, index\)/);
  assert.match(form, /mexal_posizione: index \+ 1/);
  assert.match(submit, /order\("mexal_posizione", \{ ascending: true, nullsFirst: false \}\)/);
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

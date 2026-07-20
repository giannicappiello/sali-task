import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const productsPage = await readFile("src/modules/orders/pages/Products.jsx", "utf8");
const newOrder = await readFile("src/modules/orders/pages/NewOrder.jsx", "utf8");
assert.match(productsPage, /Codice IVA/);
assert.match(productsPage, /Aliquota IVA \(%\)/);
assert.match(productsPage, /toggleSort/);
assert.match(productsPage, /IVA mancante/);
assert.match(newOrder, /codice_iva_mexal: product\.codice_iva_mexal \|\| null/);
assert.match(newOrder, /productsMissingVat/);
assert.match(newOrder, /IVA mancante per:/);
console.log("product VAT columns, sorting and order validation are wired");

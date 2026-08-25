import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../src/modules/crm/digital.css", import.meta.url), "utf8");
const component = readFileSync(new URL("../../src/modules/crm/DigitalCommerce.jsx", import.meta.url), "utf8");

test("layout copre desktop, tablet e mobile 390px", () => {
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:1024px\)/);
  assert.match(css, /@media\(max-width:768px\)/);
  assert.match(css, /@media\(max-width:480px\)/);
});

test("tabelle restano scorribili e filtri collassano su mobile", () => {
  assert.match(css, /\.crm-table\{min-width:720px\}/);
  assert.match(css, /\.crm-digital-filters[^}]*grid-template-columns:1fr/);
  assert.match(component, /className="crm-table-wrap"/);
  assert.match(component, /className="crm-digital-filters"/);
});

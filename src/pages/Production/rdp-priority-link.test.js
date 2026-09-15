import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Anticipa produzione usa un link compatto condiviso senza cambiare permessi e destinazioni", () => {
  const component = readFileSync(new URL("./RdpPriorityLink.jsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("./RdpWorkbench.jsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("./production.css", import.meta.url), "utf8");
  assert.match(component, /to = "\/revisione-priorita-produzione"/);
  assert.match(component, /<Link className="secondary-action rdp-priority-action" to=\{to\}/);
  assert.match(page, /!customerScoped && canDecide \? <RdpPriorityLink\/>/);
  assert.match(page, /!readOnly && canDecide \? <RdpPriorityLink to=/);
  assert.match(page, /revisione-priorita-produzione\?order=\$\{encodeURIComponent/);
  assert.match(css, /\.rdp-priority-action\.secondary-action \{[^}]*width: fit-content;[^}]*max-width: 100%;[^}]*text-decoration: none;/);
  assert.match(css, /\.rdp-priority-action:focus-visible/);
});

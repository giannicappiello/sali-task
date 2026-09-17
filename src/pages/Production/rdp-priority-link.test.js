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

test("lo stato OCT condivide la riga di Anticipa produzione senza duplicarsi sotto le schede", () => {
  const page = readFileSync(new URL("./RdpWorkbench.jsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("./production.css", import.meta.url), "utf8");
  assert.match(page, /\(\(!customerScoped && canDecide\) \|\| octRefresh\) && <div className="rdp-top-actions">/);
  assert.match(page, /className="rdp-top-actions">\s*\{!customerScoped && canDecide \? <RdpPriorityLink\/> : null\}\s*<BackgroundSyncStatus refresh=\{octRefresh\}\/>\s*<\/div>/);
  assert.equal((page.match(/<BackgroundSyncStatus refresh=/g) || []).length, 1);
  assert.doesNotMatch(page, /className="rdp-header-actions"/);
  assert.match(css, /\.rdp-top-actions \{[^}]*display: flex;[^}]*flex-wrap: wrap;[^}]*align-items: center;/);
  assert.match(css, /\.rdp-top-actions > \.rdp-background-sync \{[^}]*max-width: 100%;[^}]*box-sizing: border-box;/);
});

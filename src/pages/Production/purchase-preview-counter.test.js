import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("la preview PF indica sempre il documento visualizzato", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("./PurchaseRequirements.jsx", import.meta.url), "utf8"),
    readFile(new URL("./production.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /pf-preview-counter/);
  assert.match(source, /PF \{previewIndex \+ 1\} di \{pfPreview\.files\.length\}/);
  assert.match(source, /aria-live="polite"/);
  assert.match(css, /\.pf-preview-counter/);
});

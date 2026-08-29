import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("il Workbench mostra un alertdialog quando ricalcolo, creazione o conferma RdP falliscono", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("./RdpWorkbench.jsx", import.meta.url), "utf8"),
    readFile(new URL("./production.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /role="alertdialog"/);
  assert.match(source, /RdP non andata a buon fine/);
  assert.match(source, /Errore: \{failure\.code/);
  assert.match(source, /v3RecalculationFailure\(response\)/);
  assert.match(source, /refreshedDetail\?\.v3\?\.preview\?\.status/);
  assert.match(source, /components: refreshedDetail\?\.v3\?\.components/);
  assert.match(source, /setRdpFailure\(\{ code: e\.code \|\| "V3_PREVIEW_FAILED"/);
  assert.match(css, /\.rdp-error-dialog/);
  assert.match(css, /\.rdp-error-summary/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/pages/Settings/AccessUsers.jsx", import.meta.url), "utf8");

test("le sole eccezioni non aggiornano inutilmente Auth o l'anagrafica utente", () => {
  assert.match(source, /function managedUserState/);
  assert.match(source, /if \(managedChanged\) \{/);
  assert.match(source, /functions\.invoke\("admin-manage-user"/);
  assert.match(source, /workspace_eccezioni_utente"\)\.insert/);
});

test("l'errore Edge reale viene mostrato al posto del messaggio SDK generico", () => {
  assert.match(source, /error\?\.context\?\.clone\?\.\(\)\.json\(\)/);
  assert.match(source, /await edgeErrorMessage\(invocation\.error, response\)/);
});

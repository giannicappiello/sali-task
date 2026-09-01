import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260901113000_crm_customer_country_visibility.sql", import.meta.url),
  "utf8",
);
const crm = readFileSync(new URL("../../src/modules/crm/CrmModule.jsx", import.meta.url), "utf8");

test("la funzione Paese rispetta il perimetro CRM senza esporre la tabella Mexal", () => {
  assert.match(migration, /create or replace function public\.crm_customer_country/);
  assert.match(migration, /crm_customer_classification_visible/);
  assert.match(migration, /security definer/);
  assert.match(migration, /revoke all on function public\.crm_customer_country\(text, text\) from public, anon/);
  assert.match(migration, /grant execute on function public\.crm_customer_country\(text, text\) to authenticated, service_role/);
  assert.doesNotMatch(migration, /grant select on public\.ordini_clienti_cache/);
});

test("la scheda cliente recupera e mostra Paese e nazionalità", () => {
  assert.match(crm, /supabase\.rpc\("crm_customer_country"/);
  assert.match(crm, /paese: countryResult\.data/);
  assert.match(crm, /<dt>Paese \/ nazionalità<\/dt><dd>\{account\.paese \|\| "—"\}<\/dd>/);
});

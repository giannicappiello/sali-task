import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../supabase/migrations/20260912180000_crm_statement_scoped_visibility.sql", import.meta.url), "utf8");
const bulkSignatures = [
  "crm_dashboard_metrics(text,date,date,integer)",
  "crm_customer_status_counts(text)",
  "crm_customer_metric_details(text,date,date,text,text,integer,integer)",
  "crm_customer_metric_details(text,date,date,text,text,integer,integer,text)",
  "crm_customer_cadence_details(text,date)",
  "crm_customer_country_catalog(text)",
  "crm_commercial_control_order_dataset(text,date,date,text,text,text,text,text,text)",
  "crm_commercial_control_dashboard_pre_oct_fix(text,date,date,text,text,text,text,text,text,text,text)",
];

test("all shared bulk CRM readers are optimized, not a named user's grants", () => {
  for (const signature of bulkSignatures) assert.ok(migration.includes("'public." + signature + "'"));
  assert.doesNotMatch(migration, /merino|de481afc|update public\.utenti|update public\.ruoli/i);
});
test("visibility sets are uncorrelated, computed per statement, without a persistent cache", () => {
  assert.ok(migration.includes("in (select public.crm_visible_canonical_customer_codes())"));
  assert.ok(migration.includes("any((select public.crm_visible_customer_areas())::text[])"));
  assert.doesNotMatch(migration, /create (?:materialized view|table)|set_config|statement_timeout|alter role/i);
});
test("existing business SQL, RPC security attributes, signatures and grants are preserved", () => {
  assert.match(migration, /original := pg_get_functiondef\(signature::regprocedure\)/);
  assert.match(migration, /optimized := regexp_replace\(original, predicate_pattern, predicate_replacement, 'g'\)/);
  assert.doesNotMatch(migration, /drop function|grant |revoke |disable row level|security invoker;/i);
  assert.match(migration, /if optimized = original then[\s\S]*raise exception/);
  assert.match(migration, /crm_classified_customers/);
});
test("single-record mutation guards and explicit customer checks are not rewritten", () => {
  assert.doesNotMatch(migration, /public\.crm_set_customer_active|public\.crm_ensure_canonical_account|public\.crm_customer_period_metrics/);
  const pattern = /public\.crm_customer_classification_visible\(\s*([\w]+\.[\w]+)\s*,\s*([\w]+\.[\w]+)\s*\)/g;
  assert.equal("public.crm_customer_classification_visible(p_customer_code,p_crm_type)".match(pattern), null);
  assert.equal("public.crm_customer_classification_visible(\n classification.codice_cliente,\n classification.area_crm\n)".match(pattern)?.length, 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CRM_ROUTE_CATALOG } from "../../src/modules/crm/crmRouteCatalog.js";

const migration = readFileSync(new URL("../../supabase/migrations/20260824130000_crm_online_digital_commerce.sql", import.meta.url), "utf8");

test("registra le schermate Digital nei moduli autorizzativi corretti", () => {
  for (const [moduleCode, screenCode] of [
    ["crm_online_ecommerce", "crm.online.ecommerce"],
    ["crm_online_mailing", "crm.online.mailing"],
    ["crm_online_amazon", "crm.online.amazon"],
    ["crm_online_adv", "crm.online.adv"],
    ["impostazioni", "impostazioni.crm_digital"],
    ["integrazioni", "integrazioni.crm_digital"],
  ]) assert.match(migration, new RegExp(`'${moduleCode}','${screenCode}'`));
});

test("ogni route canale usa modulo e screen guard dedicati", () => {
  for (const [moduleCode, screenCode] of [
    ["crm_online_ecommerce", "crm.online.ecommerce"],
    ["crm_online_mailing", "crm.online.mailing"],
    ["crm_online_amazon", "crm.online.amazon"],
    ["crm_online_adv", "crm.online.adv"],
  ]) assert.ok(CRM_ROUTE_CATALOG.some((route) => route.moduleCode === moduleCode && route.screenCode === screenCode));
});

test("RLS, lock run e idempotenza sono obbligatori", () => {
  for (const table of ["crm_external_connections", "crm_external_orders", "crm_external_metrics", "crm_sync_runs", "crm_marketing_consents", "crm_product_mappings"]) {
    assert.match(migration, new RegExp(`['"]${table}['"]`));
  }
  assert.match(migration, /alter table public\.%I enable row level security/);
  assert.match(migration, /crm_sync_runs_single_active_idx/);
  assert.match(migration, /unique\(connection_id,sync_type,idempotency_key\)/);
  assert.match(migration, /crm_claim_sync_run/);
});

test("configurazione conserva solo riferimenti ai segreti", () => {
  assert.match(migration, /secret_references jsonb/);
  assert.doesNotMatch(migration, /access_token text|refresh_token text|api_key text|client_secret text|password text/i);
  assert.match(migration, /mai token o chiavi/i);
});

test("nessuna funzione pubblica o spesa esterna viene introdotta", () => {
  assert.doesNotMatch(migration, /publish_campaign|send_newsletter|update_amazon|spend_budget/i);
  assert.match(migration, /security invoker/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/20260825101000_crm_customer_classification_rls.sql", import.meta.url), "utf8");
const initPlanMigration = readFileSync(new URL("../../supabase/migrations/20260825104000_crm_customer_classification_rls_initplan.sql", import.meta.url), "utf8");
const lightCatalogMigration = readFileSync(new URL("../../supabase/migrations/20260825105000_crm_customer_classification_light_catalog.sql", import.meta.url), "utf8");
const crm = readFileSync(new URL("../../src/modules/crm/CrmModule.jsx", import.meta.url), "utf8");
const classificationPanel = readFileSync(new URL("../../src/modules/crm/CustomerClassificationPanel.jsx", import.meta.url), "utf8");

test("la RLS combina area CRM e scope Workspace senza allargamenti globali", () => {
  assert.match(migration, /crm_customer_classification_visible/);
  assert.match(migration, /crm_module_for_type\(target_area\)/);
  assert.match(migration, /data_scope\s+from me\) = 'tutti'/);
  assert.match(migration, /data_scope\s+from me\) = 'team'/);
  assert.match(migration, /codice_agente_mexal.*from me/s);
  assert.match(migration, /visible_mexal_agent_codes\(\)/);
  assert.match(migration, /workspace_user_is_admin|is_admin/);
});

test("la view canonica applica un filtro esplicito ed e security-barrier", () => {
  assert.match(migration, /security_invoker = false, security_barrier = true/);
  assert.match(migration, /where public\.crm_customer_classification_visible/);
  assert.match(migration, /revoke all on public\.crm_classified_customers from public, anon/);
  assert.doesNotMatch(migration, /grant select on public\.ordini_clienti_cache to authenticated/);
});

test("la policy finale usa InitPlan non correlati per aree e codici visibili", () => {
  assert.match(initPlanMigration, /select public\.crm_visible_customer_areas\(\)/);
  assert.match(initPlanMigration, /array_agg\(visible\.customer_code\)/);
  assert.match(initPlanMigration, /::text\[\]/);
  assert.doesNotMatch(initPlanMigration, /crm_customer_classifications\s+classification/);
});

test("il pannello Admin usa il catalogo leggero canonico", () => {
  assert.match(lightCatalogMigration, /security_invoker = false, security_barrier = true/);
  assert.match(lightCatalogMigration, /ordini_clienti_cache customer/);
  assert.match(lightCatalogMigration, /crm_customer_classifications classification/);
  assert.match(lightCatalogMigration, /crm_visible_customer_areas\(\)/);
  assert.match(classificationPanel, /from\("crm_customer_classification_catalog"\)/);
});
test("le liste combinano clienti canonici e soli prospect CRM-only", () => {
  assert.match(crm, /from\("crm_classified_customers"\)/);
  assert.match(crm, /crm_prospect_customer_details/);
  assert.match(crm, /p_customer_status: customerStatus/);
  assert.match(crm, /source: "Workspace\/Mexal"/);
  assert.match(crm, /source: "Prospect CRM-only"/);
  assert.match(crm, /codice_cliente_mexal: null, fonte: "crm_only"/);
});

test("il dettaglio usa una chiave canonica stabile e preserva gli UUID CRM-only", () => {
  assert.match(crm, /startsWith\("mexal:"\)/);
  assert.match(crm, /startsWith\("crm:"\)/);
  assert.match(crm, /Cliente Workspace\/Mexal/);
  assert.match(crm, /Prospect CRM-only/);
});

test("ordini, fatture e prodotti sono caricati per ogni cliente canonico autorizzato", () => {
  assert.match(crm, /customerCode \? supabase\.from\("ordini_testate"\)/);
  assert.match(crm, /customerCode \? supabase\.from\("mexal_fatture_vendita"\)/);
  assert.match(crm, /from\("mexal_fatture_vendita_righe"\)/);
  assert.match(crm, /aggregatePurchasedProducts/);
  assert.doesNotMatch(crm, /type === "b2b" && current\.codice_cliente_mexal/);
});

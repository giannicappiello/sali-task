import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CRM_ROUTE_CATALOG } from "../../src/modules/crm/crmRouteCatalog.js";
import { CRM_TYPES, VIRTUAL_DIRECT_CUSTOMER_KEY } from "../../src/modules/crm/crmConfig.js";

const migration = await readFile(new URL("../../supabase/migrations/20260905130000_crm_brand_direct_virtual_customer.sql", import.meta.url), "utf8");
const accessFixMigration = await readFile(new URL("../../supabase/migrations/20260905133000_fix_crm_brand_direct_access.sql", import.meta.url), "utf8");

test("CRM BRAND DIRECT has a dedicated catalog and canonical customer", () => {
  assert.equal(CRM_TYPES.brand_direct.moduleCode, "crm_brand_direct");
  assert.equal(VIRTUAL_DIRECT_CUSTOMER_KEY, "crm:00000000-0000-4000-8000-000000000001");
  for (const view of ["brand-direct-dashboard", "projects", "activities"]) {
    assert.ok(CRM_ROUTE_CATALOG.some((route) => route.type === "brand_direct" && route.view === view));
  }
});

test("backfill preserves real links before assigning only missing customer keys", () => {
  assert.match(migration, /project\.crm_opportunity_id=opportunity\.id/);
  assert.match(migration, /project\.crm_activity_id=activity\.id/);
  assert.match(migration, /where crm_customer_key is null/);
  assert.doesNotMatch(migration, /delete from public\.(?:v4_progetti|v4_fasi_progetto|crm_activities)/i);
  assert.doesNotMatch(migration, /truncate/i);
});

test("new records share Workspace project and task stores", async () => {
  const workflow = await readFile(new URL("../../src/modules/crm/CrmWorkflowPages.jsx", import.meta.url), "utf8");
  assert.match(workflow, /from\("v4_progetti"\)/);
  assert.match(workflow, /from\("v4_fasi_progetto"\)/);
  assert.match(workflow, /crmType=\$\{encodeURIComponent\(type\)\}/);
  assert.match(workflow, /VIRTUAL_DIRECT_CUSTOMER_KEY/);
});

test("CRM BRAND DIRECT inherits the effective DIRECT channel access", () => {
  assert.match(accessFixMigration, /assegnabile_reparto=false/);
  assert.match(accessFixMigration, /dipendenze_alternative=array\['crm_b2b','crm_online'\]/);
  assert.doesNotMatch(accessFixMigration, /(?:v4_progetti|v4_fasi_progetto|crm_activities)/);
});

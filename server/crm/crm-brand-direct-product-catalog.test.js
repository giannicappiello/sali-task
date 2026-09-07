import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const dialog = read("src/components/WorkspaceProjectCreateDialog.jsx");
const migration = read("supabase/migrations/20260907130000_brand_direct_project_product_catalog.sql");

test("i progetti BRAND DIRECT usano il catalogo canonico IT, MKT e IMP", () => {
  assert.match(dialog, /crmType === "brand_direct"[\s\S]*loadDirectProductCatalog\(supabase\)/);
  assert.match(dialog, /\.\.\.products\.map/);
  assert.match(dialog, /\.\.\.implants\.map/);
  assert.match(dialog, /nome: implant\.descrizione/);
  assert.match(dialog, /codice: implant\.codice/);
});

test("la RLS espone ai ruoli BRAND DIRECT solo il catalogo DIRECT", () => {
  assert.match(migration, /crm_has_module_level\('crm_brand_direct', 'lettura'\)/);
  assert.match(migration, /like 'IT%'/);
  assert.match(migration, /like 'MKT%'/);
  assert.match(migration, /on public\.ordini_impianti[\s\S]*like 'IMP%'/);
  assert.doesNotMatch(migration, /insert into|update public|delete from/i);
});

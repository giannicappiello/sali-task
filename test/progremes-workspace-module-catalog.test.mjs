import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Gestione produzione is the Workspace container for ProgreMES", async () => {
  const migration = await read("supabase/migrations/20260819174500_unify_progremes_workspace_modules.sql");
  assert.match(migration, /nome = 'Gestione produzione'/);
  assert.match(migration, /percorso = '\/produzione'/);
  assert.match(migration, /where codice = 'progremes'/);
});

test("every ProgreMES module is mirrored and linked in the Workspace catalog", async () => {
  const [migration, hubMigration] = await Promise.all([
    read("supabase/migrations/20260819174500_unify_progremes_workspace_modules.sql"),
    read("supabase/migrations/20260819190000_settings_and_production_hubs.sql"),
  ]);
  assert.match(migration, /from public\.progremes_moduli m/);
  assert.match(migration, /workspace_progremes_module_code/);
  assert.match(migration, /insert into public\.workspace_moduli_schermate/);
  assert.match(migration, /create trigger sync_progremes_workspace_module/);
  assert.match(hubMigration, /'progremes',[\s\S]*public\.progremes_moduli/);
  assert.match(hubMigration, /zz_add_progremes_screen_to_production_hub/);
});

test("the configured production hub navigates inside Workspace without a duplicate menu entry", async () => {
  const layout = await read("src/components/Layout.jsx");
  const home = await read("src/pages/Home/Home.jsx");
  assert.match(layout, /withProduction\.some\(\(item\) => item\.path === "\/produzione"\)/);
  assert.match(layout, /isProductionHub = item\.module === "progremes" && item\.path === "\/produzione"/);
  assert.match(home, /isProductionHub = card\.module === "progremes" && card\.path === "\/produzione"/);
  assert.match(home, /if \(!isProductionHub && \(card\.module === "progremes" \|\| card\.provider === "progremes"\)\)/);
  assert.match(home, /ModuleContainerLayout/);
  assert.match(home, /to: card\.path/);
});

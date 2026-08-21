import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260820170000_fix_non_assignable_module_visibility.sql",
  import.meta.url,
);
const migration = fs.readFileSync(migrationPath, "utf8");

test("i moduli non assegnabili non diventano implicitamente pubblici", () => {
  assert.doesNotMatch(migration, /when\s+not\s+m\.assegnabile_reparto\s+then\s+true/i);
  assert.match(migration, /else\s+false/i);
});

test("l'Admin e le eccezioni personali mantengono la precedenza", () => {
  assert.match(migration, /when\s+t\.is_admin\s+then\s+true/i);
  assert.match(migration, /decisione\s+from\s+personal_exception\)='consenti'\s+then\s+true/i);
  assert.match(migration, /decisione\s+from\s+personal_exception\)='nega'\s+then\s+false/i);
});

test("i moduli ProgreMES seguono le assegnazioni ProgreMES del reparto", () => {
  assert.match(migration, /join\s+public\.progremes_reparti_moduli/i);
  assert.match(migration, /workspace_progremes_module_code\(prm\.modulo_codice\)=target_module/i);
  assert.match(migration, /master_access\.modulo='progremes'/i);
});

test("le viste derivate seguono le dipendenze dichiarate", () => {
  assert.match(migration, /unnest\(m\.dipendenze\)/i);
  assert.match(migration, /workspace_module_enabled_for_user\(\s*target_user_id,\s*dependency\.module_code/i);
});

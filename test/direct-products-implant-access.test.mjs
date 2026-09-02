import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Prodotti Direct abilita la gestione impianti dal livello di accesso del modulo", async () => {
  const page = await read("src/modules/orders/pages/Products.jsx");

  assert.match(page, /canUseModule\("prodotti", "amministrazione"\)/);
  assert.match(page, /tab === "impianti" && canManageImplants/);
  assert.match(page, /canManageImplants && <div className="orders-product-actions">/);
  assert.doesNotMatch(page, /isAdminUser/);
});

test("le RLS consentono la scrittura solo ai gestori di Prodotti Direct", async () => {
  const migration = await read("supabase/migrations/20260902160000_direct_product_implants_write_access.sql");

  assert.match(migration, /workspace_can_manage_direct_product_implants/);
  assert.match(migration, /\(value -> 'modules'\) \? 'prodotti'/);
  assert.match(migration, /'prodotti'\) = 'amministrazione'/);
  assert.match(migration, /on public\.ordini_impianti for all to authenticated/);
  assert.match(migration, /on public\.ordini_impianti_componenti for all to authenticated/);
});

test("Prodotti Direct e Documenti Direct rispettano esclusivamente il contesto autorizzativo", async () => {
  const [authContext, migration] = await Promise.all([
    read("src/contexts/AuthContext.jsx"),
    read("supabase/migrations/20260902161000_reset_legacy_direct_module_department_grants.sql"),
  ]);

  assert.match(authContext, /hasAuthoritativeModuleContext = Array\.isArray\(accessContext\?\.modules\)/);
  assert.match(authContext, /if \(!hasAuthoritativeModuleContext && reparto_ids\.length\)/);
  assert.doesNotMatch(authContext, /if \(!nextModuleAccess\.length && reparto_ids\.length\)/);
  assert.match(migration, /where codice in \('documenti', 'prodotti'\)/);
  assert.match(migration, /sempre_disponibile = false/);
  assert.match(migration, /assegnabile_reparto = true/);
  assert.match(migration, /delete from public\.reparti_moduli/);
  assert.match(migration, /creato_il < timestamptz '2026-09-02 15:00:00\+00'/);
});

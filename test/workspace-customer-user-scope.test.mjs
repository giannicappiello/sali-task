import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la gestione utenti collega esplicitamente un account a un cliente canonico", async () => {
  const [screen, adminFunction] = await Promise.all([
    read("src/pages/Settings/AccessUsers.jsx"),
    read("supabase/functions/admin-manage-user/Index.ts"),
  ]);

  assert.match(screen, /workspace_customer_user_links/);
  assert.match(screen, /ordini_clienti_cache/);
  assert.match(screen, /Cliente associato in anagrafica/);
  assert.match(screen, /customer_code: form\.customer_code \|\| null/);
  assert.match(screen, /utente Cliente è obbligatorio selezionare/);

  assert.match(adminFunction, /saveCustomerLink/);
  assert.match(adminFunction, /workspace_customer_user_links/);
  assert.match(adminFunction, /ordini_clienti_cache/);
  assert.match(adminFunction, /cliente selezionato non esiste/i);
  assert.match(adminFunction, /onConflict: "user_id"/);
});

test("la migration applica il perimetro cliente nel database senza duplicare l'anagrafica", async () => {
  const migration = await read("supabase/migrations/20260902130000_workspace_customer_user_scope.sql");

  assert.match(migration, /create table if not exists public\.workspace_customer_user_links/);
  assert.match(migration, /references public\.ordini_clienti_cache\(codice_cliente\)/);
  assert.match(migration, /user_id uuid primary key/);
  assert.match(migration, /workspace_current_customer_code/);
  assert.match(migration, /workspace_customer_data_visible/);
  assert.match(migration, /as restrictive for select/i);
  assert.match(migration, /on public\.ordini_testate/);
  assert.match(migration, /on public\.ordini_righe/);
  assert.match(migration, /on public\.ordini_clienti_cache/);
  assert.match(migration, /on public\.mexal_fatture_vendita/);
  assert.match(migration, /on public\.mexal_fatture_vendita_righe/);
  assert.match(migration, /crm_visible_canonical_customer_codes/);
  assert.match(migration, /'customer_code'/);
  assert.match(migration, /'customer_codes'/);
  assert.match(migration, /workspace_internal_user\(\)/);
});

test("le schermate ordini filtrano anche esplicitamente per cliente e disabilitano la scrittura", async () => {
  const [access, module, customers, orders, dashboard, invoices, auth] = await Promise.all([
    read("src/modules/orders/pages/useOrdersAccess.js"),
    read("src/modules/orders/OrdersModule.jsx"),
    read("src/modules/orders/pages/Customers.jsx"),
    read("src/modules/orders/pages/Orders.jsx"),
    read("src/modules/orders/pages/OrdersDashboard.jsx"),
    read("src/modules/orders/pages/Invoices.jsx"),
    read("src/contexts/AuthContext.jsx"),
  ]);

  assert.match(auth, /customerCode: scopeContext\?\.customer_code \|\| null/);
  assert.match(access, /ruolo_ordini: "cliente"/);
  assert.match(access, /canWriteOrders: !isCustomer/);
  assert.match(module, /canWriteOrders \? <NewOrder \/>/);
  assert.match(module, /canWriteOrders \? <AIOrderImport \/>/);

  for (const source of [customers, orders, dashboard, invoices]) {
    assert.match(source, /customerCode/);
    assert.match(source, /eq\("codice_cliente", customerCode\)/);
  }

  assert.match(orders, /canWriteOrders && <button[\s\S]*?Genera con AI/);
  assert.match(dashboard, /canWriteOrders && <button[\s\S]*?Genera con AI/);
});

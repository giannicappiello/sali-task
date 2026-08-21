import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const messages = await readFile("src/pages/Messages/Messages.jsx", "utf8");
const migration = await readFile(
  "supabase/migrations/20260820171000_fix_department_group_chat_creation.sql",
  "utf8",
);

test("the new chat dialog supports department group conversations", () => {
  assert.match(messages, /chat_create_department_group/);
  assert.match(messages, /selectedDepartmentIds/);
  assert.match(messages, /Membri coinvolti/);
  assert.match(messages, /Chat di gruppo/);
  assert.match(messages, /Nuova chat di gruppo/);
  assert.match(messages, /openNewChat\("direct"\)/);
  assert.match(messages, /openNewChat\("group"\)/);
});

test("workspace administrators always see the department group option", () => {
  assert.match(
    messages,
    /canOrganizeDepartmentChats\s*=\s*adminMode\s*\|\|\s*canUseModule\("messaggi",\s*"scrittura"\)/,
  );
});

test("department group creation includes active primary and additional department members", () => {
  assert.match(migration, /u\.reparto_id = any\(p_reparto_ids\)/);
  assert.match(migration, /from public\.utenti_reparti ur/);
  assert.match(migration, /u\.attivo is not false/);
  assert.match(migration, /select profilo_id as utente_id/);
  assert.match(migration, /on conflict \(conversazione_id, utente_id\) do nothing/);
  assert.match(migration, /nuova_conversazione_id/);
  assert.doesNotMatch(migration, /declare[\s\S]*\n\s*conversazione_id uuid;/);
});

test("department group RPC validates access and input", () => {
  assert.match(migration, /workspace_module_enabled_for_user\(profilo_id, 'messaggi'\)/);
  assert.match(migration, /Seleziona almeno un reparto/);
  assert.match(migration, /reparti_trovati <> reparti_richiesti/);
  assert.match(migration, /r\.attivo is true/);
  assert.match(migration, /security definer/);
});

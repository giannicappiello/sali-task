import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Workspace e MES nascondono l'icona AI agli utenti non abilitati", async () => {
  const [workspace, mesHeader, mesAuth, migration] = await Promise.all([
    readFile(new URL("../../src/components/ContextualAIAssistant.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../_progremes_v3_fix/Components/Layout/WorkspacePageHeader.razor", import.meta.url), "utf8"),
    readFile(new URL("../../_progremes_v3_fix/Modules/Common/Security/WorkspaceAuthentication.cs", import.meta.url), "utf8"),
    readFile(new URL("../../supabase/migrations/20260912201000_progremes_sso_ai_entitlement.sql", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /hasModuleAccess\("assistente_ai"\)/);
  assert.match(mesHeader, /WorkspaceAuthentication\.CanUseAi/);
  assert.match(mesAuth, /workspace_ai_access/);
  assert.match(migration, /workspace_module_enabled_for_user\(p\.id,'assistente_ai'\)/);
});

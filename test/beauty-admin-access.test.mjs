import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Beauty Days grants Workspace administrators full access without an integration assignment", async () => {
  const edgeFunction = await read("supabase/functions/report-giornate-api/index.ts");
  assert.match(edgeFunction, /rpc\("workspace_user_is_admin"/);
  assert.match(edgeFunction, /canonicalAdmin === true \|\| role\?\.amministratore_workspace === true/);
  assert.match(edgeFunction, /const \{ data: integration \} = isAdmin\s*\? \{ data: null \}/s);
  assert.match(edgeFunction, /if \(!isAdmin && \(!integration \|\| integration\.enabled === false\)\)/);
  assert.match(edgeFunction, /access_level: isAdmin \? "admin"/);
  assert.match(edgeFunction, /allowed_pages: isAdmin/);
});

test("the administrator error state never asks for a Beauty Days assignment", async () => {
  const module = await read("src/modules/pharmacy/PharmacyModule.jsx");
  assert.match(module, /isAdminUser \? "Errore di collegamento" : "Accesso non disponibile"/);
  assert.match(module, /L'amministratore dispone sempre di accesso completo/);
  assert.match(module, /!isAdminUser \? <p>L'amministratore deve abilitare il modulo/);
});

test("Beauty Days validates sessions internally without the legacy gateway check", async () => {
  const config = await read("supabase/config.toml");
  const edgeFunction = await read("supabase/functions/report-giornate-api/index.ts");

  assert.match(config, /\[functions\.report-giornate-api\][\s\S]*?verify_jwt\s*=\s*false/);
  assert.match(edgeFunction, /authHeader\.startsWith\("Bearer "\)/);
  assert.match(edgeFunction, /primary\.auth\.getUser\(token\)/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dialog = readFileSync(new URL("../../src/components/WorkspaceProjectCreateDialog.jsx", import.meta.url), "utf8");

test("la creazione progetto usa l'identita auth richiesta dalla foreign key dell'audit", () => {
  assert.match(dialog, /const \{ profile, authUser, hasPermission \} = useAuth\(\)/);
  assert.match(dialog, /const auditActorId = authUser\?\.id \|\| null/);
  assert.match(dialog, /from\("v4_audit_log"\)[\s\S]*user_id: auditActorId/);
  assert.doesNotMatch(dialog, /from\("v4_audit_log"\)[\s\S]{0,300}user_id: actorId/);
});

test("un errore di audit non segnala come fallita una creazione gia completata", () => {
  assert.match(dialog, /if \(auditError\) console\.error\("Errore registrazione audit creazione progetto:", auditError\)/);
  assert.doesNotMatch(dialog, /if \(auditError\) throw auditError/);
});

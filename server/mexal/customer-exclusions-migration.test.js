import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260830123000_workspace_mexal_customer_exclusions.sql",
  import.meta.url,
);
const sql = await readFile(migrationUrl, "utf8");

test("l'esclusione conserva anagrafica, classificazione e storico", () => {
  assert.doesNotMatch(sql, /delete\s+from\s+public\.(ordini_clienti_cache|crm_customer_classifications)/i);
  assert.match(sql, /sync_excluded\s*=\s*true/i);
  assert.match(sql, /attivo_mexal\s*=\s*false/i);
});

test("l'operazione disattiva il layer CRM e registra audit", () => {
  assert.match(sql, /insert\s+into\s+public\.crm_customer_status/i);
  assert.match(sql, /crm_active[\s\S]*false/i);
  assert.match(sql, /insert\s+into\s+public\.crm_audit_log/i);
  assert.match(sql, /customer_excluded_reference_list/i);
});

test("la lista permanente e le viste CRM escludono i clienti bloccati", () => {
  assert.match(sql, /workspace_mexal_customer_exclusions/i);
  assert.match(sql, /customer\.sync_excluded\s+is\s+false/i);
  assert.match(sql, /auth\.role\(\)\s*<>\s*'service_role'/i);
});

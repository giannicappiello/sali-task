import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const migrationDirectory = join(process.cwd(), "supabase", "migrations");
const migrationFiles = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql"));
const timestamps = migrationFiles.map((file) => file.match(/^(\d+)_/)?.[1]).filter(Boolean);

assert.equal(new Set(timestamps).size, timestamps.length, "I timestamp delle migrazioni devono essere univoci.");

const controlSql = await readFile(join(migrationDirectory, "20260720190000_order_sync_control.sql"), "utf8");
const operationsSql = await readFile(join(migrationDirectory, "20260720230000_order_operations_atomic.sql"), "utf8");
const functions = [
  [controlSql, "public.avvia_sync_ordine(uuid, uuid)"],
  [controlSql, "public.recupera_sync_ordine_scaduta(uuid)"],
  [operationsSql, "public.aggiorna_ordine_operativo(uuid,jsonb,jsonb)"],
  [operationsSql, "public.elimina_ordine_operativo(uuid)"],
];

for (const [sql, signature] of functions) {
  for (const role of ["public", "anon", "authenticated"]) {
    assert.match(sql, new RegExp(`revoke all on function ${signature.replace(/[()]/g, "\\$&")} from ${role};`, "i"));
  }
  assert.match(sql, new RegExp(`grant execute on function ${signature.replace(/[()]/g, "\\$&")} to service_role;`, "i"));
  assert.doesNotMatch(sql, new RegExp(`grant execute on function ${signature.replace(/[()]/g, "\\$&")} to (anon|authenticated);`, "i"));
}

for (const endpoint of ["update.js", "delete.js", "recover-sync.js", "stop-sync.js"]) {
  const source = await readFile(join(process.cwd(), "api", "mexal", "orders", endpoint), "utf8");
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/, `${endpoint} deve usare il client service_role.`);
}
const submitOrderSource = await readFile(join(process.cwd(), "api", "mexal", "submit-order.js"), "utf8");
assert.match(submitOrderSource, /SUPABASE_SERVICE_ROLE_KEY/, "submit-order deve usare il client service_role.");

console.log("order RPC migrations: unique timestamps and service_role-only grants verified");

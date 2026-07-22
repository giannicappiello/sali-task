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

const commissionSql = await readFile(join(migrationDirectory, "20260722100000_mexal_commissions.sql"), "utf8");
assert.match(commissionSql, /pg_constraint[\s\S]*ordini_righe_provvigione_regola_fk/, "commission FK creation is idempotent");
assert.match(commissionSql, /create or replace function public\.salva_provvigioni_ordine\(p_ordine_id uuid, p_aggiornamenti jsonb\)/, "commission updates use a dedicated atomic RPC");
assert.match(commissionSql, /v_count <> jsonb_array_length\(p_aggiornamenti\)/, "atomic RPC rejects rows outside the order before updating any row");
assert.match(commissionSql, /update public\.ordini_righe r set provvigione_percentuale=u\.provvigione_percentuale, provvigione_regola_id=u\.provvigione_regola_id, provvigione_dettaglio_calcolo=u\.provvigione_dettaglio_calcolo, provvigione_calcolata_il=u\.provvigione_calcolata_il/, "atomic RPC updates only commission snapshot fields");
assert.match(commissionSql, /r\.provvigione_percentuale,r\.provvigione_regola_id,r\.provvigione_dettaglio_calcolo,r\.provvigione_calcolata_il/, "order replacement RPC preserves every commission snapshot field");
assert.match(submitOrderSource, /rpc\("salva_provvigioni_ordine"/, "submit saves commissions atomically");
assert.doesNotMatch(submitOrderSource, /from\("ordini_righe"\)\.update\(update\)/, "submit no longer performs partial per-line commission updates");

const numericCodesFixSql = await readFile(
  join(migrationDirectory, "20260722233000_fix_order_payment_code_integer.sql"),
  "utf8"
);

for (const [field, variable, label] of [
  ["codice_pagamento", "v_codice_pagamento", "payment"],
  ["codice_listino", "v_codice_listino", "price list"],
]) {
  assert.match(numericCodesFixSql, new RegExp(`${variable}_text := nullif\\(btrim\\(p_testata->>'${field}'\\), ''\\);`), `draft update normalizes blank ${label} codes to null`);
  assert.match(numericCodesFixSql, new RegExp(`${variable}_text !~ '\\^\\[0-9\\]\\+\\$'`), `draft update rejects non-numeric ${label} codes`);
  assert.match(numericCodesFixSql, new RegExp(`${variable} := ${variable}_text::integer;`), `draft update converts the JSON text ${label} code to integer`);
  assert.match(numericCodesFixSql, new RegExp(`${field} = ${variable}`), `the order header receives the normalized ${label} integer`);
  assert.doesNotMatch(numericCodesFixSql, new RegExp(`${field}\\s*=\\s*nullif\\(p_testata->>'${field}'`), `the RPC no longer assigns JSON text directly to the integer ${label} column`);
}

for (const field of ["quantita_ocm", "quantita_ocx", "quantita_oci"]) {
  assert.match(
    numericCodesFixSql,
    new RegExp(`coalesce\\(r\\.${field}, 0\\)`),
    `draft save preserves ${field} instead of resetting document classification`
  );
}
assert.doesNotMatch(
  numericCodesFixSql,
  /r\.quantita,\s*0,\s*0,\s*0,\s*r\.prezzo_listino/s,
  "draft save must not erase all OCM/OCX/OCI quantities"
);

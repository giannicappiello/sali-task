import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const sql = read("supabase/migrations/20260912203000_beauty_client_link_indexed_visibility.sql");

test("only the Beauty SELECT policy is changed; permissions and associations stay intact", () => {
  assert.equal((sql.match(/alter policy/gi) || []).length, 1);
  assert.match(sql, /alter policy "workspace reads visible beauty clients"/);
  assert.doesNotMatch(sql, /security definer|drop policy|create policy|grant |revoke |update public|delete from|insert into|alter role|statement_timeout/i);
});
test("lookup stays correlated and cannot become a full customer-catalog hash scan", () => {
  assert.match(sql, /c\.codice_cliente = beauty_clienti_mexal\.codice_cliente/);
  assert.match(sql, /offset 0/i);
  assert.match(sql, /from public\.ordini_clienti_cache c/);
});
test("existing active-user, agent and legacy admin conditions are preserved", () => {
  assert.match(sql, /c\.codice_agente_mexal in \(select public\.visible_mexal_agent_codes\(\)\)/);
  assert.match(sql, /u\.auth_user_id = auth\.uid\(\)/);
  assert.match(sql, /u\.attivo is not false/);
  assert.match(sql, /array\['admin', 'administrator', 'amministratore', 'super admin', 'direzione'\]/);
});
for (const page of ["Giornate", "Dashboard"]) {
  test(page + " handles rejected client loading and offers a retry instead of silent emptiness", () => {
    const source = read("src/modules/pharmacy/pages/" + page + ".jsx");
    assert.match(source, /await caricaDatiInternal\(\);\s*} catch \(error\)/);
    assert.match(source, /setErroreCaricamento\(error\?\.message/);
    assert.match(source, /<BeautyLoadError message={erroreCaricamento} onRetry={caricaDati}/);
  });
}
test("load failure is accessible and is not mistaken for no scheduled days", () => {
  const source = read("src/modules/pharmacy/components/BeautyLoadError.jsx");
  assert.match(source, /role="alert"/);
  assert.match(source, /if \(!message\) return null/);
  assert.match(source, /onClick={onRetry}>Riprova/);
});

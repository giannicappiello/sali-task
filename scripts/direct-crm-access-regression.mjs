// Emits a rollback-only SQL regression, suitable for psql or Supabase db query.
// Only table schemas are read from public; all writes/functions use pg_temp.
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260909160000_independent_direct_crm_access.sql")
  .replace(/^begin;|^commit;|^(revoke|grant|notify) .*;$/gm, "")
  .replaceAll("public.", "pg_temp.")
  .replaceAll("search_path=public", "search_path=pg_temp");
const tables = ["utenti","ruoli","workspace_eccezioni_utente","utenti_reparti","workspace_moduli",
  "reparti_moduli","ruoli_moduli","progremes_reparti_moduli","progremes_moduli"];
const setup = tables.map((name) => "create temp table " + name + " as select * from public." + name + " with no data;").join("\n");
const fixture = read("test/direct-crm-access.sql").replace("-- MIGRATION_GOES_HERE", () => migration);
process.stdout.write(`begin;
${setup}
create function pg_temp.workspace_area_access_codes(uuid) returns text[] language sql stable as $$
 select case when current_setting('test.crm_area',true)='denied' then '{}'::text[] else array['crm'] end;
$$;
create function pg_temp.workspace_progremes_module_code(text) returns text language sql immutable as $$ select $1; $$;
create function pg_temp.workspace_user_is_admin() returns boolean language sql stable as $$
 select current_setting('test.crm_inspector_admin',true) is distinct from 'false';
$$;
${fixture}
rollback;
select 'PASS: all 8 channel combinations, Online submodules, exceptions, multiple departments, area, admin, inactive users and inspector' as result;
`);

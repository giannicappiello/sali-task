import { readFileSync } from 'node:fs';
// Production SQL against isolated fixture tables. No real messages are written.
const migration = readFileSync(new URL('../supabase/migrations/20260915160000_chat_department_directory.sql',import.meta.url),'utf8');
const fixture = readFileSync(new URL('../test/chat-scope-fixtures.sql',import.meta.url),'utf8');
const [setup, assertions] = fixture.split('-- ASSERTIONS');
const definitions = migration.match(/create or replace function[\s\S]*?\$\$;/g);
if (definitions?.length !== 13) throw new Error('Unexpected chat function count: ' + definitions?.length);
definitions.push(...readFileSync(new URL('../supabase/migrations/20260917223000_chat_admin_all_users.sql',import.meta.url),'utf8').match(/create or replace function[\s\S]*?\$\$;/g));
const triggers = migration.match(/create trigger[^;]+;/g) || [];
const names = [...definitions.map(sql => sql.match(/function public\.(\w+)/)[1]), 'current_app_user_id', 'workspace_module_enabled_for_user'];
const local = (sql) => sql.replaceAll('public.','pg_temp.').replaceAll('search_path=public','search_path=pg_temp')
  .replace(new RegExp('(?<![.\\w])(' + names.join('|') + ')\\(', 'g'), 'pg_temp.$1(');
process.stdout.write(['begin;',"set local statement_timeout='20s';",setup,...definitions.map(local),...triggers.map(local),assertions,'rollback;'].join('\n'));

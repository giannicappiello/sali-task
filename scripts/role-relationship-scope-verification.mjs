import { readFileSync } from 'node:fs';

// Emit a rollback-only verification script for `supabase db query --file`.
// Functions and fixture tables are isolated in pg_temp, even on a linked DB.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20260912230000_role_relationship_data_scope.sql');
const fixture = read('../server/role-relationship-scope-fixtures.sql');
const definitions = migration.match(/create or replace function[\s\S]*?\$\$;/g);
if (definitions?.length !== 3) throw new Error('Unexpected scope migration structure');
const mapped = definitions.map(def => def.replace(/public\.(?!normalize_mexal_agent_code)/g, 'pg_temp.'));
const [setup, tests] = fixture.split('-- TESTS');
const split = setup.indexOf('create function pg_temp.visible_mexal_agent_codes');
if (split < 0 || !tests) throw new Error('Unexpected fixture structure');
process.stdout.write([
  'begin;', "set local statement_timeout='15s';", setup.slice(0, split),
  mapped[0], setup.slice(split), ...mapped.slice(1), tests,
  "select '15 relationship-scope assertions passed' as result;", 'rollback;',
].join('\n'));

/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Customer list optimization preserves RLS/RPC scopes and evaluates permissions once per statement', { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE);
  const db = new PGlite();
  const a = '00000000-0000-4000-8000-000000000011', b = '00000000-0000-4000-8000-000000000012', dept = '00000000-0000-4000-8000-000000000021';
  const read = async (file) => fs.readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8');
  try {
    await db.exec(`create role authenticated; create role anon; create role service_role;
      create sequence permission_calls;
      create function workspace_current_profile_id() returns uuid language sql stable as $$select nullif(current_setting('test.profile',true),'')::uuid$$;
      create function workspace_data_scope() returns jsonb language sql stable as $$select current_setting('test.scope')::jsonb$$;
      create function club_external_identity() returns boolean language sql stable as $$select current_setting('test.club')='true'$$;
      create function crm_module_for_type(text) returns text language sql immutable as $$select case $1 when 'conto_terzi' then 'crm_conto_terzi' when 'b2b' then 'crm_b2b' when 'online' then 'crm_online' when 'brand_direct' then 'crm_brand_direct' end$$;
      create function crm_has_module_level(m text,l text) returns boolean language plpgsql stable as $$begin
        perform nextval('permission_calls');
        return coalesce((current_setting('test.modules')::jsonb->m->>l)::boolean,false);
      end$$;
      create function crm_row_visible(owner_id uuid,department_id uuid,target_module text) returns boolean language sql stable security definer set search_path=public as $$
        with scope as materialized(select workspace_data_scope() data)
        select coalesce(crm_has_module_level(target_module,'lettura') and (data->>'mode'='tutti' or owner_id=workspace_current_profile_id()
          or (data->>'mode'='team' and (data->'user_ids' ? owner_id::text or data->'department_ids' ? department_id::text))),false) from scope$$;
      create table crm_accounts(id uuid primary key default gen_random_uuid(),tipo text,nome text,stato text,stato_relazione text,valore_cliente numeric,
        email text,telefono text,responsabile_id uuid,reparto_id uuid,codice_cliente_mexal text,paese text,ultima_attivita_il timestamptz,prossima_attivita_il timestamptz,aggiornato_il timestamptz default now());
      create table crm_customer_status(customer_key text,crm_active boolean,changed_at timestamptz,changed_by uuid,reason text);
      create table crm_opportunities(account_id uuid);
      create table ordini_clienti_cache(codice_cliente text,paese text);
      create table crm_customer_classifications(codice_cliente text,area_crm text);
      create function crm_visible_canonical_customer_codes() returns setof text language sql as $$select '501'::text$$;
      create function crm_visible_customer_areas() returns text[] language sql as $$select array['online']::text[]$$;
      create function crm_customer_classification_visible(text,text) returns boolean language sql as $$select $1='501' and $2='online'$$;
      insert into ordini_clienti_cache values('501','IT'),('denied','US');
      insert into crm_customer_classifications values('501','online'),('denied','online');
      insert into crm_accounts(tipo,nome,responsabile_id,reparto_id,paese,aggiornato_il)
        select case when n%2=0 then 'online' else 'b2b' end,'Cliente '||n,
        case n%3 when 0 then '${a}'::uuid when 1 then '${b}'::uuid else null end,
        case when n%5=0 then '${dept}'::uuid end,'IT','2026-01-01'::timestamptz+n*interval '1 second' from generate_series(1,1200) n;
      insert into crm_accounts(id,tipo,nome) values('00000000-0000-4000-8000-000000000001','brand_direct','DIRECT');
      insert into crm_customer_status select 'crm:'||id::text,false,now(),null,'test' from crm_accounts where nome='Cliente 10';
      alter table crm_accounts enable row level security;
      create policy "crm accounts scoped read" on crm_accounts for select to authenticated using (
        (id='00000000-0000-4000-8000-000000000001' and tipo='brand_direct' and crm_has_module_level('crm_brand_direct','lettura'))
        or crm_row_visible(responsabile_id,reparto_id,crm_module_for_type(tipo)));
      create policy "crm accounts scoped write" on crm_accounts for all to authenticated using (
        crm_row_visible(responsabile_id,reparto_id,crm_module_for_type(tipo)) and crm_has_module_level(crm_module_for_type(tipo),'scrittura'))
        with check (crm_row_visible(coalesce(responsabile_id,workspace_current_profile_id()),reparto_id,crm_module_for_type(tipo)) and crm_has_module_level(crm_module_for_type(tipo),'scrittura'));
      create policy club_identity_boundary on crm_accounts as restrictive for all using(not club_external_identity()) with check(not club_external_identity());
      grant usage on schema public to authenticated; grant select,insert,update on crm_accounts to authenticated;
      grant usage,select on sequence permission_calls to authenticated;`);
    const old = await read('20260825120000_crm_customer_status.sql');
    await db.exec(old.match(/create or replace function public\.crm_prospect_customer_details\([\s\S]*?\$\$;/i)[0]);
    const country = await read('20260901114500_crm_attention_customer_country.sql');
    await db.exec(country.match(/create or replace function public\.crm_customer_country_catalog\([\s\S]*?\$\$;/i)[0]);
    const modules = { crm_online: { lettura: true, scrittura: true }, crm_b2b: { lettura: false, scrittura: false }, crm_brand_direct: { lettura: true, scrittura: false } };
    const scenarios = [
      { mode: 'tutti' }, { mode: 'personali' }, { mode: 'team', user_ids: { [b]: true }, department_ids: {} },
      { mode: 'team', user_ids: {}, department_ids: { [dept]: true } }, { mode: 'unknown' },
    ];
    async function configure(scope, mod = modules, club = false) {
      await db.query("select set_config('test.scope',$1,false),set_config('test.profile',$2,false),set_config('test.modules',$3,false),set_config('test.club',$4,false)", [JSON.stringify(scope), a, JSON.stringify(mod), String(club)]);
    }
    async function snapshot(scope, mod, club) {
      await configure(scope, mod, club);
      await db.exec('set role authenticated');
      try {
        const visible = (await db.query('select id from crm_accounts order by id')).rows;
        const writable = (await db.query('update crm_accounts set nome=nome returning id')).rows.sort((x,y) => x.id.localeCompare(y.id));
        const prospects = (await db.query("select * from crm_prospect_customer_details('online',null,200,0,'all')")).rows;
        const countries = (await db.query("select * from crm_customer_country_catalog('online') order by entity_key")).rows;
        return { visible, writable, prospects, countries };
      } finally { await db.exec('reset role'); }
    }
    const before = [];
    for (const scenario of scenarios) before.push(await snapshot(scenario));
    const denied = await snapshot({ mode: 'tutti' }, {});
    const clubBefore = await snapshot({ mode: 'tutti' }, modules, true);
    await db.exec(await read('20261020163000_crm_customer_statement_permissions.sql'));
    for (const [i,scenario] of scenarios.entries()) {
      const after = await snapshot(scenario);
      assert.deepEqual(after, before[i], `scope ${scenario.mode}`);
    }
    assert.deepEqual(await snapshot({ mode: 'tutti' }, {}), denied);
    assert.deepEqual(await snapshot({ mode: 'tutti' }, modules, true), clubBefore);
    await configure({ mode: 'tutti' });
    await db.exec("select setval('permission_calls',1,false); set role authenticated;");
    await db.query('select count(*) from crm_accounts');
    await db.exec('reset role');
    assert.ok(Number((await db.query('select last_value from permission_calls')).rows[0].last_value) <= 10, 'module checks must not scale with 1200 contacts');
    await configure({ mode: 'personali' });
    await db.exec('set role authenticated');
    await db.query("insert into crm_accounts(tipo,nome,responsabile_id) values('online','Unassigned',null)");
    await assert.rejects(db.query("insert into crm_accounts(tipo,nome,responsabile_id) values('online','Other',$1)", [b]), /row-level security/);
    await db.exec('reset role');
  } finally { await db.close(); }
});

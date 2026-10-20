/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
test('optimized line reads preserve module, owner, team and Club boundaries and all write checks', { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE); const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create schema auth;
      create function workspace_data_scope() returns jsonb language sql as $$select current_setting('test.scope')::jsonb$$;
      create function workspace_current_profile_id() returns uuid language sql as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
      create function crm_digital_module_for_connection(text) returns text language sql as $$select 'crm_online_ecommerce'$$;
      create function crm_has_module_level(text,text) returns boolean language sql as $$select current_setting('test.module')::boolean$$;
      create function club_external_identity() returns boolean language sql as $$select current_setting('test.club')::boolean$$;
      create function crm_row_visible(owner_id uuid,department_id uuid,module_code text) returns boolean language sql as $$select crm_has_module_level(module_code,'lettura') and (
        workspace_data_scope()->>'mode'='tutti' or owner_id=workspace_current_profile_id() or
        (workspace_data_scope()->>'mode'='team' and (workspace_data_scope()->'user_ids' ? owner_id::text or workspace_data_scope()->'department_ids' ? department_id::text)))$$;
      create table crm_external_connections(id int primary key,tipo text); insert into crm_external_connections values(1,'ecommerce');
      create table crm_external_orders(id int primary key,connection_id int,responsabile_id uuid,reparto_id uuid);
      create table crm_external_order_lines(id int primary key,order_id int);
      insert into crm_external_orders values(1,1,'00000000-0000-4000-8000-000000000001',null),(2,1,'00000000-0000-4000-8000-000000000002',null),(3,1,'00000000-0000-4000-8000-000000000003',null);
      insert into crm_external_order_lines values(1,1),(2,2),(3,3);
      alter table crm_external_orders enable row level security; alter table crm_external_order_lines enable row level security;
      create policy orders_read on crm_external_orders for select to authenticated using(crm_row_visible(responsabile_id,reparto_id,'crm_online_ecommerce'));
      create policy "digital order lines through order" on crm_external_order_lines for all to authenticated
       using(exists(select 1 from crm_external_orders o join crm_external_connections c on c.id=o.connection_id where o.id=order_id and crm_row_visible(o.responsabile_id,o.reparto_id,crm_digital_module_for_connection(c.tipo))))
       with check(exists(select 1 from crm_external_orders o join crm_external_connections c on c.id=o.connection_id where o.id=order_id and crm_row_visible(o.responsabile_id,o.reparto_id,crm_digital_module_for_connection(c.tipo)) and crm_has_module_level(crm_digital_module_for_connection(c.tipo),'scrittura')));
      create policy club_identity_boundary on crm_external_order_lines as restrictive for all to authenticated using(not club_external_identity()) with check(not club_external_identity());
      grant select,insert,update,delete on crm_external_connections,crm_external_orders,crm_external_order_lines to authenticated;`);
    const cases = [ ['{"mode":"tutti"}',true,false], ['{"mode":"personale"}',true,false], ['{"mode":"team","user_ids":["00000000-0000-4000-8000-000000000002"]}',true,false], ['{"mode":"tutti"}',false,false], ['{"mode":"tutti"}',true,true] ];
    const read = async ([scope,module,club]) => {
      await db.query("select set_config('test.scope',$1,false),set_config('test.module',$2,false),set_config('test.club',$3,false)",[scope,String(module),String(club)]);
      await db.exec('set role authenticated');
      const rows=(await db.query('select id from crm_external_order_lines order by id')).rows;
      await db.exec('reset role'); return rows;
    };
    const before=[]; for(const item of cases) before.push(await read(item));
    const check=(await db.query("select with_check from pg_policies where policyname='digital order lines through order'")).rows[0].with_check;
    await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261020210000_crm_order_line_read_performance.sql',import.meta.url),'utf8'));
    for(let i=0;i<cases.length;i++) assert.deepEqual(await read(cases[i]),before[i]);
    assert.equal((await db.query("select with_check from pg_policies where policyname='digital order lines insert'")).rows[0].with_check,check);
  } finally { await db.close(); }
});

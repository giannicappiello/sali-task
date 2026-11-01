import process from 'node:process';

import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
test('default-presence migration blocks every clocking path and preserves authorized snapshot history',async()=>{
 const{PGlite}=await import(process.env.PGLITE_MODULE||'../.tmp/hr-test-runtime/node_modules/@electric-sql/pglite/dist/index.js');const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create function workspace_hr_actor()returns uuid language sql as $$select '11111111-1111-1111-1111-111111111111'::uuid$$;
 create table workspace_hr_members(user_id uuid,active boolean);
 create table workspace_hr_contracts(id uuid,user_id uuid,effective_from date,created_at timestamptz,weekdays int[],start_time time,end_time time,break_minutes int);
 create function workspace_hr_snapshot(p_month date default current_date,p_config boolean default false)returns jsonb language plpgsql security definer as $$begin if p_config then raise exception 'admin required';end if;return '{"employees":[],"attendance":[{"id":"preserved"}]}'::jsonb;end$$;
 grant execute on function workspace_hr_snapshot(date,boolean) to authenticated;
 create function workspace_hr_punch(p_action text,p_key uuid,p_position jsonb default null,p_attendance_id uuid default null)returns jsonb language plpgsql as $$begin return '{}';end$$;
 create function workspace_hr_location_punch(p_action text,p_key uuid,p_position jsonb,p_attendance_id uuid default null,p_reason text default null)returns jsonb language plpgsql as $$begin return '{}';end$$;
 create function workspace_hr_network_punch(p_auth_user uuid,p_action text,p_key uuid,p_ip inet,p_attendance_id uuid default null)returns jsonb language plpgsql as $$begin return '{}';end$$;
 create function workspace_hr_punch_gps(p_action text,p_key uuid,p_position jsonb default null,p_attendance_id uuid default null)returns jsonb language plpgsql as $$begin return '{}';end$$;`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261101110000_hr_default_presence.sql',import.meta.url),'utf8'));
 const result=(await db.query("select workspace_hr_snapshot() d")).rows[0].d;assert.equal(result.attendance[0].id,'preserved');assert.equal(result.attendance_policy.clocking_enabled,false);
 for(const sql of ["workspace_hr_punch('in',gen_random_uuid())","workspace_hr_punch_gps('observe',gen_random_uuid())","workspace_hr_location_punch('out',gen_random_uuid(),'{}')","workspace_hr_network_punch(gen_random_uuid(),'in',gen_random_uuid(),'127.0.0.1')"]){await assert.rejects(db.query('select '+sql),/Timbrature disattivate/);}
 await db.exec('set role authenticated');await assert.rejects(db.query('select workspace_hr_snapshot_clocking_history(current_date,false)'),/permission denied/);await assert.rejects(db.query('select workspace_hr_snapshot(current_date,true)'),/admin required/);
 assert.equal((await db.query('select workspace_hr_punch_status() d')).rows[0].d.open,null);
 }finally{await db.close();}
});

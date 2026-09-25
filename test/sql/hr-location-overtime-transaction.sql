-- Run after the migration inside a transaction and always roll back.
do $$
declare admin_id uuid; admin_auth uuid; employee uuid; employee_auth uuid; site public.workspace_hr_sites;
 result jsonb; candidate jsonb; first_token text; key1 uuid:=gen_random_uuid(); id1 uuid; saved_auth text;
 failure boolean; prior_count integer;
begin
 select u.id,u.auth_user_id into admin_id,admin_auth from utenti u join ruoli r on r.id=u.ruolo_id where u.attivo is not false and r.amministratore_workspace and u.auth_user_id is not null limit 1;
 select u.id,u.auth_user_id into employee,employee_auth from utenti u join workspace_hr_members m on m.user_id=u.id
 where m.active and u.attivo is not false and u.auth_user_id is not null and not exists(select 1 from workspace_hr_attendance a where a.user_id=u.id and a.checkout_at is null) limit 1;
 if admin_auth is null or employee_auth is null then raise exception 'Fixture identities unavailable'; end if;
 select * into site from workspace_hr_sites limit 1;
 if exists(select 1 from workspace_hr_attendance where user_id=employee and checkin_at<'2001-01-03' and checkout_at>'2001-01-01') then raise exception 'Fixture day not empty'; end if;
 insert into workspace_hr_contracts(user_id,effective_from,site_id,weekly_hours,start_time,end_time,weekdays,break_minutes,agreed_pay,pay_period,overtime_mode,overtime_rate,overtime_percent,created_by)
 values(employee,'2000-01-01',site.id,40,'08:00','16:30','{1,2,3,4,5}',30,1000,'month','paid',10,25,admin_id);
 insert into workspace_hr_attendance(user_id,site_id,request_key,checkin_at,checkout_at,checkout_kind,entry_distance,entry_accuracy,site_latitude,site_longitude,checkout_radius,auto_checkout)
 values(employee,site.id,gen_random_uuid(),'2001-01-02 08:00 Europe/Rome','2001-01-02 18:30 Europe/Rome','manual',0,1,site.latitude,site.longitude,site.checkout_radius,true);
 perform set_config('request.jwt.claim.sub',admin_auth::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_auth,'role','authenticated')::text,true);
 candidate:=workspace_hr_excess_day(employee,'2001-01-02');
 if (candidate->>'minutes')::integer is distinct from 120 then raise exception 'Expected 120 excess minutes: %',candidate; end if;
 first_token:=candidate->>'token';
 result:=workspace_hr_convert_excess(employee,'2001-01-02',45,first_token,key1);
 if (result->>'minutes')::integer<>45 then raise exception 'Partial conversion failed'; end if;
 result:=workspace_hr_convert_excess(employee,'2001-01-02',45,first_token,key1);
 candidate:=workspace_hr_excess_day(employee,'2001-01-02');
 if (candidate->>'minutes')::integer is distinct from 75 then raise exception 'Idempotency or remaining minutes failed: %',candidate; end if;
 failure:=false;
 begin perform workspace_hr_convert_excess(employee,'2001-01-02',30,first_token,gen_random_uuid()); exception when others then failure:=true; end;
 if not failure then raise exception 'Stale proposal was accepted'; end if;
 result:=workspace_hr_convert_excess(employee,'2001-01-02',75,candidate->>'token',gen_random_uuid());
 if workspace_hr_excess_day(employee,'2001-01-02') is not null then raise exception 'Fully converted day still proposed'; end if;
 perform workspace_hr_excess_candidates('2001-01-01');
 perform set_config('request.jwt.claim.sub',employee_auth::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',employee_auth,'role','authenticated')::text,true);
 if not workspace_user_is_admin() then
  failure:=false;
  begin perform workspace_hr_convert_excess(employee,'2001-01-02',1,'bad',gen_random_uuid()); exception when insufficient_privilege then failure:=true; end;
  if not failure then raise exception 'Non-admin conversion accepted'; end if;
 end if;
 -- Current employee site is resolved from the same effective plan/contract as production.
 select s.* into site from workspace_hr_sites s where s.id=coalesce((select p.site_id from workspace_hr_plan(employee,(now() at time zone 'Europe/Rome')::date) p limit 1),
 (select c.site_id from workspace_hr_contracts c where c.user_id=employee and c.effective_from<=(now() at time zone 'Europe/Rome')::date order by effective_from desc,created_at desc limit 1));
 if site.id is null then raise exception 'Fixture has no current site'; end if;
 key1:=gen_random_uuid();
 result:=workspace_hr_location_punch('in',key1,jsonb_build_object('latitude',site.latitude,'longitude',site.longitude,'accuracy',1,'sampled_at',clock_timestamp()));
 id1:=(result->>'id')::uuid;
 result:=workspace_hr_location_punch('in',key1,'{}');
 if (result->>'id')::uuid<>id1 then raise exception 'Checkin retry duplicated attendance'; end if;
 failure:=false;
 begin perform workspace_hr_location_punch('observe',gen_random_uuid(),jsonb_build_object('latitude',site.latitude+0.02,'longitude',site.longitude,'accuracy',100,'sampled_at',clock_timestamp()),id1); exception when others then failure:=true; end;
 if not failure then raise exception 'Poor GPS accepted'; end if;
 failure:=false;
 begin perform workspace_hr_location_punch('observe',gen_random_uuid(),jsonb_build_object('latitude',site.latitude+0.02,'longitude',site.longitude,'accuracy',1,'sampled_at',clock_timestamp()-interval '1 minute'),id1); exception when others then failure:=true; end;
 if not failure then raise exception 'Stale GPS accepted'; end if;
 result:=workspace_hr_location_punch('observe',gen_random_uuid(),jsonb_build_object('latitude',site.latitude,'longitude',site.longitude,'accuracy',1,'sampled_at',clock_timestamp()),id1);
 if result->>'checkout_at' is not null then raise exception 'Inside observation closed attendance'; end if;
 result:=workspace_hr_punch('observe',gen_random_uuid(),jsonb_build_object('latitude',site.latitude+0.02,'longitude',site.longitude,'accuracy',1,'sampled_at',clock_timestamp()),id1);
 if result->>'checkout_kind' is distinct from 'automatic' then raise exception 'Single outside observation did not close'; end if;
 if not exists(select 1 from notifiche where metadata->>'hr_attendance_id'=id1::text) then raise exception 'Outside notification missing'; end if;
 result:=workspace_hr_location_punch('in',gen_random_uuid(),jsonb_build_object('latitude',site.latitude,'longitude',site.longitude,'accuracy',1,'sampled_at',clock_timestamp()));
 id1:=(result->>'id')::uuid;
 failure:=false;
 begin perform workspace_hr_location_punch('out',gen_random_uuid(),jsonb_build_object('latitude',site.latitude+0.02,'longitude',site.longitude,'accuracy',1,'sampled_at',clock_timestamp()),id1,''); exception when others then failure:=true; end;
 if not failure then raise exception 'Outside checkout without reason accepted'; end if;
 result:=workspace_hr_location_punch('out',gen_random_uuid(),jsonb_build_object('latitude',site.latitude+0.02,'longitude',site.longitude,'accuracy',1,'sampled_at',clock_timestamp()),id1,'Test transazionale annullato');
 if result->>'checkout_kind' is distinct from 'manual' then raise exception 'Manual outside checkout failed'; end if;
 if not exists(select 1 from workspace_hr_attendance where id=id1 and exit_reason='Test transazionale annullato') then raise exception 'Reason not saved'; end if;
end $$;
select 'GPS: freshness, accuracy, first signal, reason, notification, idempotency. Overtime: partial, full, stale, duplicate, permissions. All passed; rollback.' as result;

-- Run after applying the migration inside an isolated transaction, or against an already migrated database.
-- Only temporary test data is created; all checks run as authenticated, with the normal 8-second limit.
begin;
create temporary table crm_verify_profiles as
select distinct on (mode) mode, auth_user_id from (
 select case when l.customer_code is not null then 'cliente' when r.amministratore_workspace then 'admin' else r.ambito_dati end as mode, u.auth_user_id
 from public.utenti u join public.ruoli r on r.id=u.ruolo_id
 left join public.workspace_customer_user_links l on l.user_id=u.id
 where u.attivo is not false and u.auth_user_id is not null
) p order by mode,auth_user_id;
grant select on crm_verify_profiles to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
set local statement_timeout='8s';
do $test$
declare p record; s jsonb; before_scope jsonb; out_rows jsonb := '[]'::jsonb;
  t timestamptz; counts jsonb; details integer; countries integer; cadence integer;
begin
 for p in select * from pg_temp.crm_verify_profiles loop
  perform set_config('request.jwt.claim.sub',p.auth_user_id::text,true);
  before_scope:=public.workspace_data_scope();
  t:=clock_timestamp();
  if public.crm_has_module_level('crm_b2b','lettura') then
   s:=public.crm_dashboard_metrics('b2b','2026-06-15','2026-09-12',90);
  else
   begin
    perform public.crm_dashboard_metrics('b2b','2026-06-15','2026-09-12',90);
    raise exception 'Unauthorized dashboard unexpectedly allowed for %',p.mode;
   exception when insufficient_privilege then s:=jsonb_build_object('denied',true);
   end;
  end if;
  counts:=public.crm_customer_status_counts('b2b');
  select count(*) into details from public.crm_customer_metric_details('b2b','2026-06-15','2026-09-12','all',null,50,0,'all');
  select count(*) into countries from public.crm_customer_country_catalog('b2b');
  select count(*) into cadence from public.crm_customer_cadence_details('b2b','2026-09-12');
  if public.workspace_data_scope() is distinct from before_scope then raise exception 'Scope mutated'; end if;
  if exists (
   select 1 from public.crm_customer_metric_details('b2b','2026-06-15','2026-09-12','all',null,50,0,'all') detail
   where detail.codice_cliente not in (select public.crm_visible_canonical_customer_codes())
  ) then raise exception 'Out-of-scope customer returned for %',p.mode; end if;
  out_rows:=out_rows || jsonb_build_array(jsonb_build_object('profile',p.mode,'ms',extract(epoch from clock_timestamp()-t)*1000,'dashboard',s,'status',counts,'detail_rows',details,'countries',countries,'cadence',cadence));
 end loop;
 perform set_config('test.crm_profiles',out_rows::text,true);
end $test$;
select current_setting('test.crm_profiles')::jsonb as profiles;
rollback;



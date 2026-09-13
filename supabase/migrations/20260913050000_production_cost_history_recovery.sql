-- Assign only productions still without a cost version; frozen assignments remain intact.
create or replace function public.production_cost_assign_missing_configurations()
returns integer language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
 update production_cost_records r set configuration_id=(
  select c.id from production_cost_configurations c
  where c.effective_from::text<=left(coalesce(
   r.evidence->'baseline'->>'capturedAt',
   (select w->>'start' from jsonb_array_elements(coalesce(r.evidence->'works','[]'::jsonb)) w where w->>'start' is not null limit 1),
   r.evidence->>'date',''),10)
  order by c.effective_from desc,c.created_at desc limit 1
 ) where r.configuration_id is null and exists(
  select 1 from production_cost_configurations c
  where c.effective_from::text<=left(coalesce(
   r.evidence->'baseline'->>'capturedAt',
   (select w->>'start' from jsonb_array_elements(coalesce(r.evidence->'works','[]'::jsonb)) w where w->>'start' is not null limit 1),
   r.evidence->>'date',''),10));
 get diagnostics affected = row_count;
 return affected;
end $$;
revoke all on function public.production_cost_assign_missing_configurations() from public,anon,authenticated;
grant execute on function public.production_cost_assign_missing_configurations() to service_role;
select public.production_cost_assign_missing_configurations();

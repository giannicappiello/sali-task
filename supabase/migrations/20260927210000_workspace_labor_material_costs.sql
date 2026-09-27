begin;
alter table public.crm_workspace_costs
 add column cost_type text not null default 'general' check(cost_type in ('general','labor','materials')),
 add column hours numeric(10,2),
 add column hourly_rate numeric(12,2),
 add column operator_name text;
alter table public.crm_workspace_costs add constraint workspace_cost_labor_fields check (
 (cost_type='labor' and hours is not null and hours>0 and hours<>'NaN'::numeric
 and hourly_rate is not null and hourly_rate>=0 and hourly_rate<>'NaN'::numeric
 and operator_name is not null and length(btrim(operator_name)) between 1 and 200)
 or (cost_type<>'labor' and hours is null and hourly_rate is null and operator_name is null));

create or replace function public.validate_workspace_labor_cost()
returns trigger language plpgsql set search_path=public as $$
declare allowed_rate numeric:=30;
begin
 if new.cost_type='labor' then
  if tg_op='UPDATE' and old.cost_type='labor' then allowed_rate:=old.hourly_rate; end if;
  new.hourly_rate:=coalesce(new.hourly_rate,30);
  if not public.workspace_user_is_admin() and new.hourly_rate is distinct from allowed_rate then
   raise exception 'Solo un amministratore può modificare il costo orario.' using errcode='42501';
  end if;
  new.operator_name:=btrim(new.operator_name);
  new.amount:=round(new.hours*new.hourly_rate,2);
 end if;
 return new;
end $$;
create trigger workspace_labor_cost_validation before insert or update on public.crm_workspace_costs
for each row execute function public.validate_workspace_labor_cost();
notify pgrst,'reload schema';
commit;

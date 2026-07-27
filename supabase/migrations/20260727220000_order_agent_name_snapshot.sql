begin;

alter table public.ordini_testate
  add column if not exists agente_nome text;

create or replace function public.resolve_mexal_agent_name(agent_code text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(
    btrim(concat_ws(' ', nullif(btrim(a.nome), ''), nullif(btrim(a.cognome), ''))),
    ''
  )
  from public.mexal_agenti a
  where public.normalize_mexal_agent_code(a.codice)
    = public.normalize_mexal_agent_code(agent_code)
  order by
    case when upper(btrim(a.codice)) = upper(btrim(agent_code)) then 0 else 1 end,
    a.attivo_mexal desc nulls last,
    a.aggiornato_il desc nulls last
  limit 1;
$$;

update public.ordini_testate o
set agente_nome = public.resolve_mexal_agent_name(o.codice_agente_mexal)
where nullif(btrim(coalesce(o.codice_agente_mexal, '')), '') is not null
  and (
    nullif(btrim(coalesce(o.agente_nome, '')), '') is null
    or o.agente_nome is distinct from
      public.resolve_mexal_agent_name(o.codice_agente_mexal)
  );

create or replace function public.set_order_agent_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(coalesce(new.agente_nome, '')), '') is null
     or new.codice_agente_mexal is distinct from old.codice_agente_mexal then
    new.agente_nome :=
      public.resolve_mexal_agent_name(new.codice_agente_mexal);
  end if;
  return new;
end;
$$;

drop trigger if exists ordini_testate_agent_name
  on public.ordini_testate;
create trigger ordini_testate_agent_name
before insert or update of codice_agente_mexal, agente_nome
on public.ordini_testate
for each row execute function public.set_order_agent_name();

revoke all on function public.resolve_mexal_agent_name(text)
  from public, anon;
grant execute on function public.resolve_mexal_agent_name(text)
  to authenticated, service_role;

commit;

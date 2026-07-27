begin;

alter table public.integrazioni_utenti
  add column if not exists mexal_agente_id uuid
  references public.mexal_agenti(id)
  on delete set null;

create index if not exists integrazioni_utenti_mexal_agente_idx
  on public.integrazioni_utenti(mexal_agente_id)
  where mexal_agente_id is not null;

-- Il codice sul profilo è una copia tecnica sincronizzata da Mexal:
-- non deve essere compilato manualmente.
create or replace function public.sync_workspace_mexal_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.utenti
       set mexal_agente_id = null, codice_agente_mexal = null
     where id = old.workspace_utente_id;
    return old;
  end if;
  if tg_op <> 'INSERT'
     and old.workspace_utente_id is distinct from new.workspace_utente_id
     and old.workspace_utente_id is not null then
    update public.utenti
       set mexal_agente_id = null, codice_agente_mexal = null
     where id = old.workspace_utente_id;
  end if;
  if new.workspace_utente_id is not null then
    update public.utenti
       set mexal_agente_id = new.id, codice_agente_mexal = new.codice
     where id = new.workspace_utente_id;
  end if;
  return new;
end;
$$;

drop trigger if exists mexal_agenti_sync_workspace_user on public.mexal_agenti;
create trigger mexal_agenti_sync_workspace_user
after insert or update of workspace_utente_id, codice or delete
on public.mexal_agenti
for each row execute function public.sync_workspace_mexal_agent();

update public.utenti u
   set mexal_agente_id = a.id, codice_agente_mexal = a.codice
  from public.mexal_agenti a
 where a.workspace_utente_id = u.id;

create or replace function public.visible_mexal_agent_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  with me as (
    select u.id, u.mexal_agente_id, r.nome role_name, r.livello
    from public.utenti u left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid() and u.attivo is not false
  )
  select a.id from public.mexal_agenti a, me
   where a.attivo_mexal is not false
     and (coalesce(me.livello,0) >= 80 or lower(coalesce(me.role_name,'')) in
       ('admin','administrator','amministratore','super admin','direzione'))
  union
  select me.mexal_agente_id from me where me.mexal_agente_id is not null
  union
  select a.id from public.mexal_agenti a join me on a.responsabile_utente_id = me.id
   where a.attivo_mexal is not false
  union
  select iu.mexal_agente_id from public.integrazioni_utenti iu join me on me.id = iu.utente_id
   where iu.modulo = 'report_giornate' and iu.enabled is true and iu.mexal_agente_id is not null;
$$;

create or replace function public.visible_mexal_agent_codes()
returns setof text
language sql stable security definer set search_path = public
as $$
  select a.codice from public.mexal_agenti a
  where a.id in (select public.visible_mexal_agent_ids());
$$;

create or replace function public.visible_workspace_user_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  with me as (
    select id from public.utenti
    where auth_user_id = auth.uid() and attivo is not false
  )
  select id from me
  union
  select a.workspace_utente_id from public.mexal_agenti a
   where a.id in (select public.visible_mexal_agent_ids())
     and a.workspace_utente_id is not null
  union
  select iu.utente_id from public.integrazioni_utenti iu
   where iu.modulo = 'report_giornate' and iu.enabled is true
     and iu.mexal_agente_id in (select public.visible_mexal_agent_ids());
$$;

revoke all on function public.visible_mexal_agent_ids() from public, anon;
revoke all on function public.visible_mexal_agent_codes() from public, anon;
revoke all on function public.visible_workspace_user_ids() from public, anon;
grant execute on function public.visible_mexal_agent_ids() to authenticated, service_role;
grant execute on function public.visible_mexal_agent_codes() to authenticated, service_role;
grant execute on function public.visible_workspace_user_ids() to authenticated, service_role;

commit;

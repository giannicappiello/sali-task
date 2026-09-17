begin;

create or replace function public.chat_is_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(select 1 from utenti u join ruoli r on r.id=u.ruolo_id
    where u.id=p_user_id and u.attivo is not false and r.amministratore_workspace is true);
$$;

create or replace function public.chat_pair_allowed(p_first uuid,p_second uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(select 1 from utenti where id=p_first and attivo is not false)
    and exists(select 1 from utenti where id=p_second and attivo is not false)
    and (p_first=p_second or chat_is_admin(p_first) or chat_is_admin(p_second) or (chat_is_leader(p_first) and chat_is_leader(p_second))
      or chat_department_ids(p_first) && chat_department_ids(p_second));
$$;

create or replace function public.chat_members_compatible(p_ids uuid[])
returns boolean language sql stable security definer set search_path=public
as $$
  with members as materialized (
    select requested.id, u.id is not null and u.attivo is not false as active,
      chat_is_admin(u.id) as admin, chat_is_leader(u.id) as leader, chat_department_ids(u.id) as departments
    from unnest(p_ids) requested(id) left join utenti u on u.id=requested.id
  )
  select not exists(select 1 from members a cross join members b
    where not a.active or not b.active or not (a.id=b.id or a.admin or b.admin or (a.leader and b.leader) or a.departments && b.departments));
$$;

create or replace function public.chat_directory()
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare actor uuid; result jsonb;
begin
  select id into actor from utenti where auth_user_id=auth.uid() and attivo is not false;
  if actor is null or not workspace_module_enabled_for_user(actor,'messaggi') then
    raise exception 'Accesso ai messaggi non autorizzato' using errcode='42501';
  end if;
  select jsonb_build_object(
    'departments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'nome',nome) order by nome),'[]') from reparti where attivo is true),
    'users',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'nome',u.nome,'cognome',u.cognome,'attivo',true,
      'ruoli',jsonb_build_object('nome',r.nome,'amministratore_workspace',coalesce(r.amministratore_workspace,false)),
      'utenti_reparti',(select coalesce(jsonb_agg(jsonb_build_object('reparto_id',d)),'[]') from unnest(chat_department_ids(u.id)) d)) order by u.nome,u.cognome),'[]')
      from utenti u left join ruoli r on r.id=u.ruolo_id where u.attivo is not false
        and (u.id=actor or chat_is_admin(actor) or chat_is_admin(u.id) or chat_is_leader(u.id) or chat_department_ids(u.id) && chat_department_ids(actor)))) into result;
  return result;
end;
$$;

create or replace function public.chat_create_department_group(p_titolo text,p_reparto_ids uuid[])
returns uuid language plpgsql security definer set search_path=public
as $$
declare actor uuid; department_id uuid; department_name text; members uuid[]; own boolean;
begin
  select id into actor from utenti where auth_user_id=auth.uid() and attivo is not false;
  if actor is null or not workspace_module_enabled_for_user(actor,'messaggi') then
    raise exception 'Accesso ai messaggi non autorizzato' using errcode='42501';
  end if;
  if coalesce(cardinality(p_reparto_ids),0)<>1 then raise exception 'Seleziona un reparto'; end if;
  department_id:=p_reparto_ids[1];
  select nome into department_name from reparti where id=department_id and attivo is true;
  if department_name is null then raise exception 'Reparto non valido'; end if;
  own:=chat_is_admin(actor) or department_id=any(chat_department_ids(actor));
  if not own and not chat_is_leader(actor) then raise exception 'Puoi contattare solo il tuo reparto' using errcode='42501'; end if;
  select array_agg(u.id) into members from utenti u where u.attivo is not false
    and department_id=any(chat_department_ids(u.id)) and (own or chat_is_leader(u.id));
  return chat_create_people_group(left(department_name || case when own then '' else ' · Referenti' end,120),members);
end;
$$;

revoke all on function public.chat_is_admin(uuid) from public,anon,authenticated;

commit;

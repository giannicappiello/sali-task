begin;

create or replace function public.chat_is_leader(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(select 1 from utenti u join ruoli r on r.id=u.ruolo_id
    where u.id=p_user_id and u.attivo is not false
      and (lower(btrim(r.nome))='direzione' or lower(btrim(r.nome)) ~ '^(responsabile|direttore|direttrice)([[:space:]]|$)'));
$$;

create or replace function public.chat_department_ids(p_user_id uuid)
returns uuid[] language sql stable security definer set search_path=public
as $$
  select coalesce(array_agg(distinct d.id),'{}'::uuid[]) from reparti d
  where d.attivo is true and (exists(select 1 from utenti u where u.id=p_user_id and u.reparto_id=d.id)
    or exists(select 1 from utenti_reparti ur where ur.utente_id=p_user_id and ur.reparto_id=d.id));
$$;

create or replace function public.chat_pair_allowed(p_first uuid,p_second uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(select 1 from utenti where id=p_first and attivo is not false)
    and exists(select 1 from utenti where id=p_second and attivo is not false)
    and (p_first=p_second or (chat_is_leader(p_first) and chat_is_leader(p_second))
      or chat_department_ids(p_first) && chat_department_ids(p_second));
$$;

create or replace function public.chat_members_compatible(p_ids uuid[])
returns boolean language sql stable security definer set search_path=public
as $$
  with members as materialized (
    select requested.id, u.id is not null and u.attivo is not false as active,
      chat_is_leader(u.id) as leader, chat_department_ids(u.id) as departments
    from unnest(p_ids) requested(id) left join utenti u on u.id=requested.id
  )
  select not exists(select 1 from members a cross join members b
    where not a.active or not b.active or not (a.id=b.id or (a.leader and b.leader) or a.departments && b.departments));
$$;

create or replace function public.chat_can_send(p_conversazione_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(select 1 from utenti u join chat_partecipanti cp on cp.utente_id=u.id
    where u.auth_user_id=auth.uid() and u.attivo is not false and cp.conversazione_id=p_conversazione_id
      and workspace_module_enabled_for_user(u.id,'messaggi'))
    and chat_members_compatible(array(select utente_id from chat_partecipanti where conversazione_id=p_conversazione_id));
$$;

create or replace function public.chat_writable_conversations(p_ids uuid[])
returns uuid[] language sql stable security definer set search_path=public
as $$ select coalesce(array_agg(id),'{}'::uuid[]) from unnest(p_ids) id where chat_can_send(id); $$;

-- Only names, roles and membership needed by the directory, even where the
-- ordinary users table is restricted to a supervisor's reporting hierarchy.
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
      'ruoli',jsonb_build_object('nome',r.nome),
      'utenti_reparti',(select coalesce(jsonb_agg(jsonb_build_object('reparto_id',d)),'[]') from unnest(chat_department_ids(u.id)) d)) order by u.nome,u.cognome),'[]')
      from utenti u left join ruoli r on r.id=u.ruolo_id where u.attivo is not false
        and (u.id=actor or chat_is_leader(u.id) or chat_department_ids(u.id) && chat_department_ids(actor)))) into result;
  return result;
end;
$$;

create or replace function public.chat_create_people_group(p_titolo text,p_user_ids uuid[])
returns uuid language plpgsql security definer set search_path=public
as $$
declare actor uuid; members uuid[]; conversation_id uuid;
begin
  select id into actor from utenti where auth_user_id=auth.uid() and attivo is not false;
  if actor is null or not workspace_module_enabled_for_user(actor,'messaggi') then
    raise exception 'Accesso ai messaggi non autorizzato' using errcode='42501';
  end if;
  select array_agg(distinct id order by id) into members from unnest(array_append(coalesce(p_user_ids,'{}'),actor)) id where id is not null;
  if cardinality(members)<2 then raise exception 'Seleziona almeno un destinatario'; end if;
  if nullif(btrim(p_titolo),'') is null or char_length(btrim(p_titolo))>120 then raise exception 'Nome del gruppo non valido'; end if;
  if not chat_members_compatible(members) then
    raise exception 'Il gruppo contiene persone che non possono chattare tra reparti diversi' using errcode='42501';
  end if;
  -- Repeated taps or simultaneous requests reopen the same group.
  perform pg_advisory_xact_lock(hashtextextended('chat-group:' || array_to_string(members,','),0));
  select c.id into conversation_id from chat_conversazioni c where c.tipo='gruppo'
    and (select array_agg(cp.utente_id order by cp.utente_id) from chat_partecipanti cp where cp.conversazione_id=c.id)=members
    order by c.created_at limit 1;
  if conversation_id is not null then return conversation_id; end if;
  insert into chat_conversazioni(titolo,tipo,created_by) values(btrim(p_titolo),'gruppo',actor) returning id into conversation_id;
  insert into chat_partecipanti(conversazione_id,utente_id) select conversation_id,id from unnest(members) id;
  return conversation_id;
end;
$$;

create or replace function public.chat_create_direct(p_other_user_id uuid)
returns uuid language plpgsql security definer set search_path=public
as $$
declare actor uuid; conversation_id uuid; members uuid[];
begin
  select id into actor from utenti where auth_user_id=auth.uid() and attivo is not false;
  if actor is null or not workspace_module_enabled_for_user(actor,'messaggi') then
    raise exception 'Accesso ai messaggi non autorizzato' using errcode='42501';
  end if;
  if p_other_user_id is null or actor=p_other_user_id or not chat_pair_allowed(actor,p_other_user_id) then
    raise exception 'Puoi contattare il tuo reparto; tra reparti diversi possono chattare solo responsabili e direttori' using errcode='42501';
  end if;
  select array_agg(id order by id) into members from unnest(array[actor,p_other_user_id]) id;
  perform pg_advisory_xact_lock(hashtextextended('chat-direct:' || array_to_string(members,','),0));
  select c.id into conversation_id from chat_conversazioni c where c.tipo='diretta'
    and (select array_agg(cp.utente_id order by cp.utente_id) from chat_partecipanti cp where cp.conversazione_id=c.id)=members
    order by c.created_at limit 1;
  if conversation_id is not null then return conversation_id; end if;
  insert into chat_conversazioni(tipo,created_by) values('diretta',actor) returning id into conversation_id;
  insert into chat_partecipanti(conversazione_id,utente_id) select conversation_id,id from unnest(members) id;
  return conversation_id;
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
  own:=department_id=any(chat_department_ids(actor));
  if not own and not chat_is_leader(actor) then raise exception 'Puoi contattare solo il tuo reparto' using errcode='42501'; end if;
  select array_agg(u.id) into members from utenti u where u.attivo is not false
    and department_id=any(chat_department_ids(u.id)) and (own or chat_is_leader(u.id));
  return chat_create_people_group(left(department_name || case when own then '' else ' · Referenti' end,120),members);
end;
$$;

-- Triggers also protect legacy RPCs (SECURITY DEFINER) and direct table writes.
create or replace function public.chat_guard_message()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if tg_op='UPDATE' and (new.conversazione_id is distinct from old.conversazione_id or new.mittente_id is distinct from old.mittente_id) then
    raise exception 'Non è possibile cambiare mittente o conversazione' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('chat-members:' || new.conversazione_id::text,0));
  if new.mittente_id is distinct from current_app_user_id() or not chat_can_send(new.conversazione_id) then
    raise exception 'Invio non consentito dalle regole di reparto' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger chat_enforce_message_scope before insert or update on chat_messaggi for each row execute function chat_guard_message();

create or replace function public.chat_guard_membership()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if tg_op='UPDATE' then
    if new.conversazione_id is distinct from old.conversazione_id or new.utente_id is distinct from old.utente_id then
      raise exception 'Non è possibile spostare la partecipazione a una chat' using errcode='42501';
    end if;
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('chat-members:' || new.conversazione_id::text,0));
  if not exists(select 1 from chat_conversazioni c where c.id=new.conversazione_id and c.created_by=current_app_user_id())
    or not chat_pair_allowed(current_app_user_id(),new.utente_id)
    or exists(select 1 from chat_partecipanti p where p.conversazione_id=new.conversazione_id and not chat_pair_allowed(p.utente_id,new.utente_id)) then
    raise exception 'Partecipante non consentito dalle regole di reparto' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger chat_enforce_membership_scope before insert or update on chat_partecipanti for each row execute function chat_guard_membership();

create or replace function public.chat_guard_attachment()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if new.caricato_da_id is distinct from current_app_user_id() or not chat_can_send(new.conversazione_id)
    or not exists(select 1 from chat_messaggi m where m.id=new.messaggio_id and m.conversazione_id=new.conversazione_id and m.mittente_id=new.caricato_da_id) then
    raise exception 'Allegato non consentito' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger chat_enforce_attachment_scope before insert or update on chat_allegati for each row execute function chat_guard_attachment();

-- Conversation creation is atomic through the checked RPCs only.
revoke insert on public.chat_conversazioni,public.chat_partecipanti from authenticated,anon;
create policy chat_conversation_history_scope on public.chat_conversazioni as restrictive for select to authenticated
  using (chat_user_can_access(id) or workspace_user_is_admin());
create policy chat_message_history_scope on public.chat_messaggi as restrictive for select to authenticated
  using (chat_user_can_access(conversazione_id) or workspace_user_is_admin());

revoke all on function public.chat_is_leader(uuid),public.chat_department_ids(uuid),public.chat_pair_allowed(uuid,uuid),public.chat_members_compatible(uuid[]),public.chat_guard_message(),public.chat_guard_membership(),public.chat_guard_attachment() from public,anon,authenticated;
revoke all on function public.chat_directory(),public.chat_can_send(uuid),public.chat_writable_conversations(uuid[]),public.chat_create_people_group(text,uuid[]),public.chat_create_direct(uuid),public.chat_create_department_group(text,uuid[]) from public,anon;
grant execute on function public.chat_directory(),public.chat_can_send(uuid),public.chat_writable_conversations(uuid[]),public.chat_create_people_group(text,uuid[]),public.chat_create_direct(uuid),public.chat_create_department_group(text,uuid[]) to authenticated;

commit;

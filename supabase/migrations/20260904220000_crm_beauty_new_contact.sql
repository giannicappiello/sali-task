begin;

create or replace function public.crm_create_beauty_visit(
  p_customer_code text,
  p_customer_name text,
  p_address text,
  p_city text,
  p_phone text,
  p_email text,
  p_title text,
  p_starts_at timestamptz,
  p_target_latitude double precision default null,
  p_target_longitude double precision default null,
  p_legacy_giornata_id uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare
  v_actor uuid := public.workspace_current_profile_id();
  v_account public.crm_accounts%rowtype;
  v_customer public.ordini_clienti_cache%rowtype;
  v_activity_id uuid;
begin
  if v_actor is null or not public.crm_has_module_level('crm_b2b','scrittura') then
    raise exception 'Creazione visita non autorizzata';
  end if;
  if p_starts_at is null then raise exception 'Data della visita obbligatoria'; end if;
  if nullif(btrim(p_idempotency_key),'') is not null then
    select id into v_activity_id from public.crm_activities where idempotency_key=btrim(p_idempotency_key);
    if found then return jsonb_build_object('activity_id',v_activity_id,'idempotent',true); end if;
  end if;

  if nullif(btrim(p_customer_code),'') is not null then
    select * into v_account from public.crm_accounts
    where tipo='b2b' and codice_cliente_mexal=btrim(p_customer_code) limit 1;
    if not found then
      select * into v_customer from public.ordini_clienti_cache
      where codice_cliente=btrim(p_customer_code) and attivo_mexal is true limit 1;
      if not found then raise exception 'Cliente Mexal non trovato o non autorizzato'; end if;
      insert into public.crm_accounts(tipo,nome,stato,responsabile_id,codice_cliente_mexal,fonte,
        partita_iva,email,telefono,indirizzo,citta,provincia,paese,creato_da)
      values('b2b',coalesce(nullif(btrim(v_customer.ragione_sociale),''),btrim(p_customer_code)),'cliente',v_actor,
        btrim(p_customer_code),'mexal',v_customer.partita_iva,v_customer.email,
        v_customer.telefono,v_customer.indirizzo,v_customer.localita,v_customer.provincia,v_customer.paese,v_actor)
      returning * into v_account;
    end if;
  else
    if nullif(btrim(p_customer_name),'') is null then
      raise exception 'Nome del nuovo contatto obbligatorio';
    end if;
    insert into public.crm_accounts(tipo,nome,stato,responsabile_id,fonte,email,telefono,indirizzo,citta,creato_da)
    values('b2b',btrim(p_customer_name),'prospect',v_actor,'beauty_field',nullif(btrim(p_email),''),
      nullif(btrim(p_phone),''),nullif(btrim(p_address),''),nullif(btrim(p_city),''),v_actor)
    returning * into v_account;
  end if;

  if not public.crm_row_visible(coalesce(v_account.responsabile_id,v_actor),v_account.reparto_id,'crm_b2b') then
    raise exception 'Cliente fuori dal perimetro autorizzato';
  end if;
  insert into public.crm_activities(crm_tipo,account_id,tipo,titolo,stato,data_attivita,responsabile_id,reparto_id,
    source_type,source_id,idempotency_key,creato_da)
  values('b2b',v_account.id,'visita_beauty',coalesce(nullif(btrim(p_title),''),'Visita Beauty - '||v_account.nome),
    'pianificata',p_starts_at,coalesce(v_account.responsabile_id,v_actor),v_account.reparto_id,
    case when p_legacy_giornata_id is null then 'beauty_crm' else 'beauty_legacy' end,p_legacy_giornata_id,
    nullif(btrim(p_idempotency_key),''),v_actor)
  returning id into v_activity_id;
  insert into public.crm_visit_details(activity_id,legacy_giornata_id,target_latitude,target_longitude,target_address)
  values(v_activity_id,p_legacy_giornata_id,p_target_latitude,p_target_longitude,nullif(btrim(p_address),''));
  insert into public.crm_audit_log(utente_id,entita_tipo,entita_id,operazione,dettagli)
  values(v_actor,'beauty_visit',v_activity_id,'visita_creata',jsonb_build_object('account_id',v_account.id,'legacy_giornata_id',p_legacy_giornata_id));
  return jsonb_build_object('activity_id',v_activity_id,'account_id',v_account.id,'idempotent',false);
end $$;

revoke all on function public.crm_create_beauty_visit(text,text,text,text,text,text,text,timestamptz,double precision,double precision,uuid,text) from public,anon;
grant execute on function public.crm_create_beauty_visit(text,text,text,text,text,text,text,timestamptz,double precision,double precision,uuid,text) to authenticated,service_role;

comment on function public.crm_create_beauty_visit(text,text,text,text,text,text,text,timestamptz,double precision,double precision,uuid,text)
is 'Crea una visita Beauty per cliente Mexal o nuovo contatto CRM; il nome è obbligatorio, la sede può essere completata successivamente.';

commit;

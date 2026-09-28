begin;

-- Restore the authorized customer OCT workflow without removing the database boundary.
create or replace function public.workspace_customer_private_order_readonly()
returns trigger language plpgsql security definer set search_path=public as $$
declare parent_id uuid;
begin
  if auth.role()='authenticated' and public.workspace_customer_record_scope() then
    if cardinality(public.workspace_current_customer_codes())=0 or not coalesce(public.workspace_module_enabled_for_user(public.workspace_current_profile_id(),'ordini_private'),false) then
      raise exception 'Accesso al modulo OrdiniPrivate non abilitato' using errcode='42501';
    end if;
    if tg_table_name='ordini_testate' then
      if tg_op='DELETE' then
        raise exception 'Il cliente non può eliminare le testate ordine' using errcode='42501';
      end if;
      if tg_op='UPDATE' then
        if lower(coalesce(old.modulo_ordini,''))<>'private' or lower(coalesce(old.stato,''))<>'bozza'
          or not coalesce(public.workspace_customer_data_visible(old.codice_cliente),false) then
          raise exception 'Il cliente può modificare soltanto le proprie bozze OCT Private' using errcode='42501';
        end if;
      end if;
      if lower(coalesce(new.modulo_ordini,''))<>'private'
        or not coalesce(public.workspace_customer_data_visible(new.codice_cliente),false)
        or (tg_op='INSERT' and lower(coalesce(new.stato,''))<>'bozza')
        or (tg_op='UPDATE' and lower(coalesce(new.stato,'')) not in ('bozza','aperto')) then
        raise exception 'Il cliente può creare e confermare soltanto i propri OCT Private' using errcode='42501';
      end if;
    else
      if tg_op<>'INSERT' then
        parent_id := old.ordine_id;
        if not exists(select 1 from public.ordini_testate o where o.id=parent_id
          and lower(coalesce(o.modulo_ordini,''))='private' and lower(coalesce(o.stato,''))='bozza'
          and public.workspace_customer_data_visible(o.codice_cliente)) then
          raise exception 'Righe modificabili soltanto nelle proprie bozze OCT Private' using errcode='42501';
        end if;
      end if;
      if tg_op<>'DELETE' then
        parent_id := new.ordine_id;
        if not exists(select 1 from public.ordini_testate o where o.id=parent_id
          and lower(coalesce(o.modulo_ordini,''))='private' and lower(coalesce(o.stato,''))='bozza'
          and public.workspace_customer_data_visible(o.codice_cliente)) then
          raise exception 'Righe modificabili soltanto nelle proprie bozze OCT Private' using errcode='42501';
        end if;
      end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

notify pgrst,'reload schema';
commit;

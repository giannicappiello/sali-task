begin;

alter table public.ordini_testate add column if not exists mexal_eliminato_il timestamptz;
comment on column public.ordini_testate.mexal_eliminato_il is
  'Mexal explicitly confirmed the source OCT missing. Logical retirement only; source and production history are retained.';

create or replace function public.retire_deleted_mexal_oct(
  p_order_id uuid, p_module_code text, p_year integer,
  p_source_key text, p_seen_sync_at timestamptz
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_order_id uuid;
begin
  update public.ordini_testate
     set mexal_eliminato_il = now()
   where id = p_order_id and origine = 'mexal_oct'
     and mexal_cod_modulo = p_module_code and mexal_sigla = 'OC'
     and concat(mexal_sigla, '+', mexal_serie, '+', mexal_numero) = p_source_key
     and coalesce(mexal_anno, extract(year from data_ordine)::integer) = p_year
     and mexal_eliminato_il is null
     and mexal_sincronizzato_il is not distinct from p_seen_sync_at
  returning id into v_order_id;
  if v_order_id is null then return false; end if;
  update public.ordini_righe
     set mexal_attiva = false, mexal_ritirata_il = coalesce(mexal_ritirata_il, now())
   where ordine_id = v_order_id and mexal_attiva = true;
  return true;
end;
$$;
revoke all on function public.retire_deleted_mexal_oct(uuid, text, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.retire_deleted_mexal_oct(uuid, text, integer, text, timestamptz) to service_role;

commit;

-- Legacy imports stored an unknown source year as zero. Use the order date,
-- preserving the explicit Mexal missing-document evidence and concurrency guard.
begin;
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
     and coalesce(nullif(mexal_anno, 0), extract(year from data_ordine)::integer) = p_year
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

create or replace function public.queue_deleted_oct() returns trigger language plpgsql security definer set search_path=public as $$
declare body jsonb;
begin
  if new.mexal_eliminato_il is null then
    update public.workspace_oct_deletions set status='SUPERSEDED' where order_id=new.id and status='PENDING';
    new.mexal_mes_eliminato_il:=null;
    new.mexal_mes_eliminazione_errore:=null;
    return new;
  end if;
  if old.mexal_eliminato_il is not distinct from new.mexal_eliminato_il then return new; end if;
  body:=jsonb_build_object('contractVersion',4,'workspaceOctId',new.id,
    'octReference',concat(new.mexal_sigla,'/',new.mexal_serie,'/',new.mexal_numero),
    'deletedAt',new.mexal_eliminato_il,'sourceYear',coalesce(nullif(new.mexal_anno,0),extract(year from new.data_ordine)::int),
    'workspaceLineIds',coalesce((select jsonb_agg(id order by id) from public.ordini_righe where ordine_id=new.id),'[]'::jsonb),
    'rdpExternalIds',coalesce((select jsonb_agg(distinct r.external_id) from public.workspace_production_requests r
      where r.ordine_id=new.id or exists(select 1 from public.workspace_production_request_items i where i.production_request_id=r.id and i.ordine_id=new.id)),'[]'::jsonb));
  insert into public.workspace_oct_deletions(order_id,deleted_at,payload) values(new.id,new.mexal_eliminato_il,body)
  on conflict(order_id) do update set generation=gen_random_uuid(),deleted_at=excluded.deleted_at,payload=excluded.payload,
    status='PENDING',last_error=null,mes_response=null,completed_at=null,attempts=0;
  new.mexal_mes_eliminato_il:=null;
  new.mexal_mes_eliminazione_errore:='Eliminazione ordine e lavorazioni MES in attesa.';
  return new;
end $$;

-- Repair only pending requests with existing confirmed deletion evidence.
update public.workspace_oct_deletions q
set payload=jsonb_set(q.payload,'{sourceYear}',to_jsonb(extract(year from o.data_ordine)::int))
from public.ordini_testate o
where q.order_id=o.id and q.status='PENDING'
  and q.deleted_at=o.mexal_eliminato_il and o.mexal_eliminato_il is not null
  and (q.payload->>'sourceYear')::int=0 and o.mexal_anno=0
  and extract(year from o.data_ordine) between 2000 and 9999;
commit;

-- Server-only operation invoked after the API has authenticated an administrator.
-- Deleting the header cascades to rows, Mexal child documents and the email queue.
create or replace function public.elimina_ordine_operativo(p_ordine_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
  from public.ordini_testate
  where id = p_ordine_id
  for update;

  if not found then
    raise exception 'Ordine non trovato' using errcode = 'P0002';
  end if;

  delete from public.mexal_sync_runs
  where metadata @> jsonb_build_object('order_id', p_ordine_id::text);

  delete from public.ordini_email_invio
  where ordine_id = p_ordine_id;

  delete from public.ordini_sync_mexal_log
  where ordine_id = p_ordine_id;

  delete from public.ordini_documenti_mexal
  where ordine_id = p_ordine_id;

  delete from public.ordini_righe
  where ordine_id = p_ordine_id;

  delete from public.ordini_testate
  where id = p_ordine_id;
end;
$$;

revoke all on function public.elimina_ordine_operativo(uuid) from public, anon, authenticated;
grant execute on function public.elimina_ordine_operativo(uuid) to service_role;

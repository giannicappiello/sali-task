begin;
create function public.warehouse_reset_rejected_ddt(p_id uuid,p_version integer,p_actor uuid,p_event uuid,p_token uuid,p_evidence jsonb)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.warehouse_order_preparations; previous jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('warehouse-order-preparation',0));
 select * into strict r from public.warehouse_order_preparations where id=p_id for update;
 if exists(select 1 from public.warehouse_preparation_events where preparation_id=p_id and event_id=p_event) then return to_jsonb(r);end if;
 if not exists(select 1 from public.utenti where id=p_actor and attivo is not false) then raise exception 'Operatore non valido';end if;
 if r.status<>'uncertain' or r.version<>p_version or r.export_token is distinct from p_token then raise exception 'Tentativo di emissione non corrispondente';end if;
 if r.error not like '6001%Mancano dei campi chiave e/o obbligatori: sigla_ordine serie_ordine numero_ordine%' then raise exception 'Rifiuto gestionale non riconosciuto';end if;
 if coalesce((p_evidence->>'searchEmpty')::boolean,false) is not true or coalesce((p_evidence->>'historyOnlySourceOrder')::boolean,false) is not true or p_evidence->>'orderHash' is distinct from r.source_hash then raise exception 'Assenza documento o ordine invariato non verificati';end if;
 if exists(select 1 from public.warehouse_preparation_documents where preparation_id=p_id) or exists(select 1 from public.warehouse_shipment_emails where preparation_id=p_id) or exists(select 1 from public.warehouse_print_jobs where preparation_id=p_id) then raise exception 'Documenti o invii già registrati';end if;
 previous:=jsonb_build_object('exportToken',r.export_token,'payload',r.export_payload,'error',r.error);
 delete from public.warehouse_preparation_lot_holds where preparation_id=p_id;
 update public.warehouse_order_preparations set status='draft',verification=null,export_token=null,export_payload=null,ddt=null,error=null,confirmed_document=null,dispatch_snapshot=null,version=version+1,updated_by=p_actor,updated_at=now() where id=p_id returning * into r;
 insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload) values(p_id,p_event,'ddt_rejected_without_document',p_actor,previous||p_evidence);
 return to_jsonb(r);
end;$$;
revoke all on function public.warehouse_reset_rejected_ddt(uuid,integer,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.warehouse_reset_rejected_ddt(uuid,integer,uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;

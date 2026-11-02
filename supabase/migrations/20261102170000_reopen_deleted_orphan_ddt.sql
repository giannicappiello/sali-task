begin;
create function public.warehouse_reopen_deleted_ddt(p_id uuid,p_version integer,p_actor uuid,p_request uuid,p_evidence jsonb)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.warehouse_order_preparations; claim public.warehouse_preparation_events;
begin
 perform pg_advisory_xact_lock(hashtextextended('warehouse-order-preparation',0));
 select * into strict r from public.warehouse_order_preparations where id=p_id for update;
 if exists(select 1 from public.warehouse_preparation_events where preparation_id=p_id and event_type='orphan_ddt_deleted' and payload->>'requestId'=p_request::text) then return to_jsonb(r);end if;
 if not exists(select 1 from public.utenti where id=p_actor and attivo is not false) then raise exception 'Operatore non valido';end if;
 if r.status<>'uncertain' or r.version<>p_version then raise exception 'Preparazione cambiata: aggiornare prima del recupero';end if;
 select * into strict claim from public.warehouse_preparation_events where preparation_id=p_id and event_id=p_request and event_type='orphan_ddt_delete_requested';
 if claim.payload->>'exportToken' is distinct from r.export_token::text or claim.actor<>p_actor then raise exception 'Richiesta di recupero non corrispondente';end if;
 if coalesce((p_evidence->>'documentAbsent')::boolean,false) is not true or coalesce((p_evidence->>'searchEmpty')::boolean,false) is not true or p_evidence->>'reference' is distinct from claim.payload->>'reference' then raise exception 'Cancellazione Mexal non verificata';end if;
 if exists(select 1 from public.warehouse_preparation_documents where preparation_id=p_id) or exists(select 1 from public.warehouse_shipment_emails where preparation_id=p_id) or exists(select 1 from public.warehouse_print_jobs where preparation_id=p_id) then raise exception 'Documenti o invii già registrati: recupero automatico bloccato';end if;
 delete from public.warehouse_preparation_lot_holds where preparation_id=p_id;
 update public.warehouse_order_preparations set status='draft',verification=null,export_token=null,export_payload=null,ddt=null,error=null,confirmed_document=null,dispatch_snapshot=null,version=version+1,updated_by=p_actor,updated_at=now() where id=p_id returning * into r;
 insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload)
 values(p_id,gen_random_uuid(),'orphan_ddt_deleted',p_actor,p_evidence||jsonb_build_object('requestId',p_request,'previousExportToken',claim.payload->>'exportToken','requiresNewVerification',true));
 return to_jsonb(r);
end;$$;
revoke all on function public.warehouse_reopen_deleted_ddt(uuid,integer,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.warehouse_reopen_deleted_ddt(uuid,integer,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;

begin;
alter table public.warehouse_preparation_settings add column email_customers boolean not null default true, add column email_agents boolean not null default true;
create or replace function public.warehouse_configure_preparation(p_actor uuid,p_expected timestamptz,p_settings jsonb)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare old public.warehouse_preparation_settings;next public.warehouse_preparation_settings;
begin
 if not exists(select 1 from public.utenti where id=p_actor and attivo is not false) then raise exception 'Utente non valido';end if;
 select * into strict old from public.warehouse_preparation_settings where id=true for update;
 if p_expected is null or old.updated_at<>p_expected then raise exception 'Configurazione aggiornata: ricarica' using errcode='40001';end if;
 select * into next from jsonb_populate_record(old,p_settings);
 update public.warehouse_preparation_settings set ddt_series=next.ddt_series,default_warehouse=next.default_warehouse,
  box_tare_kg=next.box_tare_kg,pallet_tare_kg=next.pallet_tare_kg,
  bcf_contract_verified=next.bcf_contract_verified,contract_evidence=next.contract_evidence,ddt_pdf_path=next.ddt_pdf_path,
  email_customers=next.email_customers,email_agents=next.email_agents,backoffice_emails=next.backoffice_emails,email_subject=next.email_subject,email_body=next.email_body,
  ddt_printer_id=next.ddt_printer_id,packing_printer_id=next.packing_printer_id,updated_at=clock_timestamp() where id=true returning * into next;
 insert into public.warehouse_dispatch_configuration_events(actor,before_settings,after_settings) values(p_actor,to_jsonb(old),to_jsonb(next));
 return to_jsonb(next);
end;$$;
notify pgrst,'reload schema';
commit;

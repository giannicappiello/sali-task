begin;
insert into public.ai_action_registry(code,system,risk_level,input_schema,required_permission,active)
values('DDT_ARCHIVED_PDF_REFRESH','mes','write','{"type":"object","additionalProperties":false,"required":["preparationIds","reason"],"properties":{"preparationIds":{"type":"array","minItems":1,"maxItems":50,"uniqueItems":true,"items":{"type":"string","format":"uuid"}},"reason":{"type":"string","minLength":5,"maxLength":500}}}',
'integrations.configure',true)
on conflict(code) do update set input_schema=excluded.input_schema,required_permission=excluded.required_permission,active=true,updated_at=now();

create function public.warehouse_refresh_ddt_pdf(p_proposal uuid,p_actor uuid,p_id uuid,p_files jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare action public.ai_action_audit; prep public.warehouse_order_preparations; original record; copies record;
 target jsonb; f jsonb; entry jsonb; snapshot jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN';end if;
 select * into action from public.ai_action_audit where id=p_proposal and user_id=p_actor for update;
 if action.id is null or action.tool<>'DDT_ARCHIVED_PDF_REFRESH' then raise exception 'NOT_FOUND';end if;
 if not exists(select 1 from public.ai_action_registry where code=action.tool and active) then raise exception 'TOOL_NOT_ALLOWED';end if;
 if action.status<>'confirmed' or action.confirmed_at is null then raise exception 'HUMAN_CONFIRMATION_REQUIRED';end if;
 if not exists(select 1 from public.utenti u join public.ruoli r on r.id=u.ruolo_id where u.id=p_actor and u.attivo is not false and r.amministratore_workspace is true)
 or public.workspace_screen_permission_for_user(p_actor,'warehouse.fulfillment.write','magazzino.allestisci_ordini') is distinct from true then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(action.result->'updated','[]'::jsonb)) item where item->>'id'=p_id::text) then return jsonb_build_object('alreadyUpdated',true,'id',p_id);end if;
 select value into target from jsonb_array_elements(action.payload_summary->'targets') where value->>'id'=p_id::text;
 if target is null or action.payload_summary->>'printModule'<>'1' then raise exception 'TARGET_NOT_CONFIRMED';end if;
 select * into strict prep from public.warehouse_order_preparations where id=p_id for update;
 if prep.status<>'completed' or prep.ddt->>'signature'<>'BCF' or prep.ddt->>'reference' is distinct from target->>'reference' or prep.source->>'year' is distinct from target->>'year' then raise exception 'Documento cambiato' using errcode='40001';end if;
 select * into strict original from public.warehouse_current_preparation_documents where preparation_id=p_id and kind='bcf';
 select * into strict copies from public.warehouse_current_preparation_documents where preparation_id=p_id and kind='bcf_print';
 if original.sha256 is distinct from target->>'expectedSha' or copies.sha256 is distinct from target->>'expectedPrintSha' then raise exception 'PDF cambiati dopo la proposta' using errcode='40001';end if;
 if exists(select 1 from public.warehouse_print_jobs where preparation_id=p_id and document_kind='bcf_print' and status in('queued','leased','printing','uncertain')) then raise exception 'Stampa precedente in corso o con esito incerto';end if;
 if exists(select 1 from public.warehouse_shipment_emails where preparation_id=p_id and status in('queued','leased','sending','retry','uncertain')) then raise exception 'Invio email precedente in corso o con esito incerto';end if;
 if jsonb_typeof(p_files)<>'array' or jsonb_array_length(p_files)<>2 or (select count(distinct value->>'kind') from jsonb_array_elements(p_files) where value->>'kind' in('bcf','bcf_print'))<>2 then raise exception 'PDF correttivi incompleti';end if;
 snapshot:=original.snapshot||jsonb_build_object('pdfPrintModule','1','dispatch',coalesce(original.snapshot->'dispatch','{}'::jsonb)||jsonb_build_object('pdfPrintModule','1'),'reason',action.payload_summary->>'reason','previousSha256',original.sha256,'proposalId',p_proposal);
 for f in select value from jsonb_array_elements(p_files) loop
  if coalesce(f->>'sha256','')!~'^[a-f0-9]{64}$' or coalesce(length(f->>'base64'),0) not between 1 and 14000000 or substring(decode(f->>'base64','base64') from 1 for 5)<>convert_to('%PDF-','UTF8') then raise exception 'PDF correttivo non valido';end if;
  insert into public.warehouse_preparation_document_revisions(preparation_id,kind,filename,sha256,base64,snapshot,actor)
  values(p_id,f->>'kind',f->>'filename',f->>'sha256',f->>'base64',snapshot,p_actor);
 end loop;
 entry:=jsonb_build_object('id',p_id,'document',target->>'document','previousSha256',original.sha256,'sha256',(select value->>'sha256' from jsonb_array_elements(p_files) where value->>'kind'='bcf'),'printModule','1');
 insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload)
 values(p_id,gen_random_uuid(),'ddt_pdf_corrected',p_actor,entry||jsonb_build_object('reason',action.payload_summary->>'reason','proposalId',p_proposal,'documents',(select jsonb_agg(value-'base64') from jsonb_array_elements(p_files))));
 update public.ai_action_audit set result=coalesce(result,'{}'::jsonb)||jsonb_build_object('updated',coalesce(result->'updated','[]'::jsonb)||jsonb_build_array(entry)) where id=p_proposal;
 return entry;
end;$$;
revoke all on function public.warehouse_refresh_ddt_pdf(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.warehouse_refresh_ddt_pdf(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;

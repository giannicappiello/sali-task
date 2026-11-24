begin;

-- Calendar editing uses the existing private HR request table, authorization,
-- overlap trigger and absence assignment RPC. No attendance rows are rewritten.
create or replace function public.workspace_hr_save_calendar_request(p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $calendar$
declare
 actor uuid:=workspace_hr_actor();
 target uuid:=(p_data->>'user_id')::uuid;
 key uuid:=(p_data->>'request_key')::uuid;
 request_id uuid:=nullif(p_data->>'id','')::uuid;
 kind text:=p_data->>'kind';
 starts timestamptz:=(p_data->>'starts_at')::timestamptz;
 ends timestamptz:=(p_data->>'ends_at')::timestamptz;
 v_note text:=btrim(coalesce(p_data->>'note',''));
 previous public.workspace_hr_requests;
 saved public.workspace_hr_requests;
 contract public.workspace_hr_contracts;
 replay jsonb; before_value jsonb; result jsonb;
begin
 if not workspace_user_is_admin() and not exists(select 1 from workspace_hr_members m where m.user_id=actor and m.active and m.manager) then
  raise exception 'Gestione HR non autorizzata' using errcode='42501';
 end if;
 if target is null or not exists(select 1 from workspace_hr_members m join utenti u on u.id=m.user_id where m.user_id=target and m.active and u.attivo is not false) then
  raise exception 'Dipendente non attivo';
 end if;
 if key is null then raise exception 'Identificativo salvataggio obbligatorio'; end if;
 if kind is null or kind not in ('leave','permission','illness','pregnancy','overtime') then raise exception 'Causale non valida'; end if;
 if starts is null or ends is null or starts>='infinity'::timestamptz or starts<='-infinity'::timestamptz or ends>='infinity'::timestamptz or ends<=starts or ends-starts>interval '366 days' then
  raise exception 'Periodo non valido';
 end if;
 if v_note='' or length(v_note)>2000 then raise exception 'Inserisci una motivazione (massimo 2000 caratteri)'; end if;
 perform pg_advisory_xact_lock(hashtextextended('hr-calendar-key:'||actor||':'||key,0));
 perform pg_advisory_xact_lock(hashtextextended('hr:'||target,0));
 select details into replay from workspace_hr_audit where actor_id=actor and action='calendar_request.save' and details->>'request_key'=key::text limit 1;
 if found then
  if replay->'payload' is distinct from (p_data-'request_key') then raise exception 'Identificativo salvataggio già utilizzato con dati diversi'; end if;
  return replay->'result';
 end if;
 if kind='overtime' then
  if ends-starts>interval '16 hours' then raise exception 'Lo straordinario non può superare 16 ore'; end if;
  select * into contract from workspace_hr_contracts where user_id=target and effective_from<=(starts at time zone 'Europe/Rome')::date order by effective_from desc,created_at desc limit 1;
  if not found or contract.overtime_mode='disabled' then raise exception 'Straordinario non abilitato per il dipendente'; end if;
 end if;
 if request_id is not null then
  select * into previous from workspace_hr_requests where id=request_id and user_id=target for update;
  if not found or previous.status not in ('approved','pending') or previous.kind not in ('leave','permission','illness','pregnancy','overtime') then
   raise exception 'Evento non modificabile o non trovato';
  end if;
  before_value:=jsonb_build_object('kind',previous.kind,'starts_at',previous.starts_at,'ends_at',previous.ends_at,'note',previous.note,'status',previous.status);
  if jsonb_typeof(p_data->'expected') is distinct from 'object'
   or p_data->'expected'->>'kind' is distinct from previous.kind
   or (p_data->'expected'->>'starts_at')::timestamptz is distinct from previous.starts_at
   or (p_data->'expected'->>'ends_at')::timestamptz is distinct from previous.ends_at
   or p_data->'expected'->>'note' is distinct from previous.note
   or p_data->'expected'->>'status' is distinct from previous.status then
   raise exception 'Evento modificato da un altro utente. Aggiorna il prospetto prima di riprovare';
  end if;
  if target=actor and previous.status='approved' and (kind='overtime' or previous.kind='overtime') then
   raise exception 'Il tuo straordinario approvato deve essere modificato da un altro responsabile';
  end if;
  update workspace_hr_requests r set kind=p_data->>'kind', starts_at=starts, ends_at=ends, note=v_note,
   reviewed_by=case when r.status='approved' then actor else r.reviewed_by end,
   reviewed_at=case when r.status='approved' then now() else r.reviewed_at end
  where r.id=request_id returning * into saved;
 elsif kind<>'overtime' then
  result:=workspace_hr_admin_request(p_data);
  select * into saved from workspace_hr_requests where id=(result->>'id')::uuid;
 else
  insert into workspace_hr_requests(request_key,user_id,kind,starts_at,ends_at,note,status,reviewed_by,reviewed_at)
   values(key,target,kind,starts,ends,v_note,case when target=actor then 'pending' else 'approved' end,
    case when target<>actor then actor end,case when target<>actor then now() end) returning * into saved;
 end if;
 result:=jsonb_build_object('id',saved.id,'status',saved.status);
 insert into workspace_hr_audit(actor_id,action,target_id,details) values(actor,'calendar_request.save',saved.id,
  jsonb_build_object('request_key',key,'payload',p_data-'request_key','before',before_value,'after',to_jsonb(saved),'result',result));
 return result;
end $calendar$;
revoke all on function public.workspace_hr_save_calendar_request(jsonb) from public,anon;
grant execute on function public.workspace_hr_save_calendar_request(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

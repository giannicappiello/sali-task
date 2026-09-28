begin;
set local lock_timeout = '5s';
-- Association-based access takes precedence over operative role and ownership.
create or replace function public.workspace_customer_record_scope()
returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(public.workspace_data_scope()->>'mode'='cliente',false)
   or cardinality(public.workspace_current_customer_codes())>0
$$;
create or replace function public.workspace_linked_customer_record(p_key text,p_type text)
returns boolean language sql stable security definer set search_path=public as $$
 select public.workspace_current_profile_id() is not null
 and p_type='conto_terzi'
 and public.crm_has_module_level('crm_conto_terzi','lettura')
 and (exists(select 1 from unnest(public.workspace_current_customer_codes()) c
             where p_key='mexal:'||c)
   or exists(select 1 from public.crm_accounts a where p_key='crm:'||a.id::text
       and a.codice_cliente_mexal=any(public.workspace_current_customer_codes())))
$$;

create or replace function public.workspace_visible_project_ids() returns uuid[] language plpgsql stable security definer set search_path=public as $$
 begin
 if public.workspace_customer_record_scope() then return (select coalesce(array_agg(p.id),'{}'::uuid[]) from public.v4_progetti p where public.workspace_linked_customer_record(p.crm_customer_key,p.crm_tipo)); end if;
 return (with me as materialized(select public.workspace_current_profile_id() id,public.workspace_data_scope() scope),
  direct as materialized(select unnest(public.workspace_direct_phase_ids()) id),
  departments as materialized(
    select ur.reparto_id id from public.utenti_reparti ur join public.reparti d on d.id=ur.reparto_id and d.attivo is not false,me where ur.utente_id=me.id
    union select value::uuid from me,jsonb_array_elements_text(me.scope->'department_ids')
  )
  select coalesce(array_agg(p.id),'{}'::uuid[]) from public.v4_progetti p cross join me
  where me.id is not null and (me.scope->>'mode'='tutti' or p.creato_da=me.id
    or exists(select 1 from public.v4_fasi_progetto f where f.progetto_id=p.id and f.id in(select id from direct))
    or (me.scope->>'mode'<>'cliente' and exists(select 1 from public.v4_progetto_reparti pr where pr.progetto_id=p.id and pr.reparto_id in(select id from departments)))));
 end $$;

create or replace function public.workspace_visible_phase_ids() returns uuid[] language plpgsql stable security definer set search_path=public as $$
 begin
 if public.workspace_customer_record_scope() then return (select coalesce(array_agg(f.id),'{}'::uuid[]) from public.v4_fasi_progetto f left join public.v4_progetti p on p.id=f.progetto_id where public.workspace_linked_customer_record(coalesce(p.crm_customer_key,f.crm_customer_key),coalesce(p.crm_tipo,f.crm_tipo))); end if;
 return (select coalesce(array_agg(f.id),'{}'::uuid[]) from public.v4_fasi_progetto f
  where f.id=any((select public.workspace_direct_phase_ids())::uuid[])
    or f.progetto_id=any((select public.workspace_visible_project_ids())::uuid[]));
 end $$;

create or replace function public.workspace_customer_entity(p_type text,p_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select case when p_type='fase_progetto' then p_id=any(public.workspace_visible_phase_ids())
 when p_type='progetto' then p_id=any(public.workspace_visible_project_ids()) else false end
$$;
create policy "linked customer read" on public.v4_progetti for select to authenticated using(public.workspace_customer_record_scope() and id=any(public.workspace_visible_project_ids()));
create policy "linked customer read boundary" on public.v4_progetti as restrictive for select to authenticated using(not public.workspace_customer_record_scope() or id=any(public.workspace_visible_project_ids()));
create policy "linked customer read" on public.v4_fasi_progetto for select to authenticated using(public.workspace_customer_record_scope() and id=any(public.workspace_visible_phase_ids()));
create policy "linked customer read boundary" on public.v4_fasi_progetto as restrictive for select to authenticated using(not public.workspace_customer_record_scope() or id=any(public.workspace_visible_phase_ids()));
create policy "customer denies insert" on public.v4_progetti as restrictive for insert to authenticated with check(not public.workspace_customer_record_scope());
create policy "customer denies update" on public.v4_progetti as restrictive for update to authenticated using(not public.workspace_customer_record_scope()) with check(not public.workspace_customer_record_scope());
create policy "customer denies delete" on public.v4_progetti as restrictive for delete to authenticated using(not public.workspace_customer_record_scope());
create policy "customer denies insert" on public.v4_fasi_progetto as restrictive for insert to authenticated with check(not public.workspace_customer_record_scope());
create policy "customer denies update" on public.v4_fasi_progetto as restrictive for update to authenticated using(not public.workspace_customer_record_scope()) with check(not public.workspace_customer_record_scope());
create policy "customer denies delete" on public.v4_fasi_progetto as restrictive for delete to authenticated using(not public.workspace_customer_record_scope());
create policy "customer denies insert" on public.v4_progetto_reparti as restrictive for insert to authenticated with check(not public.workspace_customer_record_scope());
create policy "customer denies update" on public.v4_progetto_reparti as restrictive for update to authenticated using(not public.workspace_customer_record_scope()) with check(not public.workspace_customer_record_scope());
create policy "customer denies delete" on public.v4_progetto_reparti as restrictive for delete to authenticated using(not public.workspace_customer_record_scope());
create policy "customer denies insert" on public.v4_progetto_prodotti as restrictive for insert to authenticated with check(not public.workspace_customer_record_scope());
create policy "customer denies update" on public.v4_progetto_prodotti as restrictive for update to authenticated using(not public.workspace_customer_record_scope()) with check(not public.workspace_customer_record_scope());
create policy "customer denies delete" on public.v4_progetto_prodotti as restrictive for delete to authenticated using(not public.workspace_customer_record_scope());
create policy "customer denies insert" on public.v4_fase_reparti as restrictive for insert to authenticated with check(not public.workspace_customer_record_scope());
create policy "customer denies update" on public.v4_fase_reparti as restrictive for update to authenticated using(not public.workspace_customer_record_scope()) with check(not public.workspace_customer_record_scope());
create policy "customer denies delete" on public.v4_fase_reparti as restrictive for delete to authenticated using(not public.workspace_customer_record_scope());
create policy "customer denies insert" on public.v4_fase_prodotti as restrictive for insert to authenticated with check(not public.workspace_customer_record_scope());
create policy "customer denies update" on public.v4_fase_prodotti as restrictive for update to authenticated using(not public.workspace_customer_record_scope()) with check(not public.workspace_customer_record_scope());
create policy "customer denies delete" on public.v4_fase_prodotti as restrictive for delete to authenticated using(not public.workspace_customer_record_scope());
create policy "customer denies insert" on public.crm_workspace_costs as restrictive for insert to authenticated with check(not public.workspace_customer_record_scope());
create policy "customer denies update" on public.crm_workspace_costs as restrictive for update to authenticated using(not public.workspace_customer_record_scope()) with check(not public.workspace_customer_record_scope());
create policy "customer denies delete" on public.crm_workspace_costs as restrictive for delete to authenticated using(not public.workspace_customer_record_scope());
create policy "customer contribution read" on public.v4_commenti for select to authenticated using(public.workspace_customer_record_scope() and public.workspace_customer_entity(entity_type,entity_id));
create policy "customer contribution read boundary" on public.v4_commenti as restrictive for select to authenticated using(not public.workspace_customer_record_scope() or public.workspace_customer_entity(entity_type,entity_id));
create policy "customer contribution insert" on public.v4_commenti for insert to authenticated with check(public.workspace_customer_record_scope() and public.workspace_customer_entity(entity_type,entity_id) and creato_da=auth.uid());
create policy "customer contribution insert boundary" on public.v4_commenti as restrictive for insert to authenticated with check(not public.workspace_customer_record_scope() or (public.workspace_customer_entity(entity_type,entity_id) and creato_da=auth.uid()));
create policy "customer contribution no update" on public.v4_commenti as restrictive for update to authenticated using(not public.workspace_customer_record_scope());
create policy "customer contribution no delete" on public.v4_commenti as restrictive for delete to authenticated using(not public.workspace_customer_record_scope());
create policy "customer contribution read" on public.v4_allegati for select to authenticated using(public.workspace_customer_record_scope() and public.workspace_customer_entity(entity_type,entity_id));
create policy "customer contribution read boundary" on public.v4_allegati as restrictive for select to authenticated using(not public.workspace_customer_record_scope() or public.workspace_customer_entity(entity_type,entity_id));
create policy "customer contribution insert" on public.v4_allegati for insert to authenticated with check(public.workspace_customer_record_scope() and public.workspace_customer_entity(entity_type,entity_id) and caricato_da=public.workspace_current_profile_id());
create policy "customer contribution insert boundary" on public.v4_allegati as restrictive for insert to authenticated with check(not public.workspace_customer_record_scope() or (public.workspace_customer_entity(entity_type,entity_id) and caricato_da=public.workspace_current_profile_id()));
create policy "customer contribution no update" on public.v4_allegati as restrictive for update to authenticated using(not public.workspace_customer_record_scope());
create policy "customer contribution no delete" on public.v4_allegati as restrictive for delete to authenticated using(not public.workspace_customer_record_scope());

-- Narrow RPC is the only customer path to change a task. All other columns remain untouched.
create or replace function public.workspace_customer_task_status(p_task_id uuid,p_status text)
returns void language plpgsql security definer set search_path=public as $$
declare task public.v4_fasi_progetto%rowtype; actor uuid:=public.workspace_current_profile_id();
begin
 select * into task from public.v4_fasi_progetto where id=p_task_id for update;
 if not found then raise exception 'Task non trovata'; end if;
 if actor is null or not public.workspace_customer_record_scope() or not p_task_id=any(public.workspace_visible_phase_ids()) then
   raise exception 'Task non autorizzata' using errcode='42501'; end if;
 if p_status is null or p_status not in ('da_evadere','in_lavorazione','in_valutazione','evaso') then raise exception 'Stato non valido'; end if;
 if task.stato=p_status then return; end if;
 if task.bloccante_id is not null and exists(select 1 from public.v4_fasi_progetto b where b.id=task.bloccante_id and b.completato_at is null and lower(b.stato) not in ('evaso','evasa','completato','completata','chiuso','chiusa')) then raise exception 'Completa prima la task precedente'; end if;
 update public.v4_fasi_progetto set stato=p_status,completato_at=case when p_status='evaso' then now() else null end,
 completato_da=case when p_status='evaso' then actor else null end,modificato_da=actor,updated_at=now() where id=p_task_id;
 insert into public.v4_audit_log(entity_type,entity_id,azione,dettagli,user_id)
 values('fase_progetto',p_task_id,'cambio stato cliente',jsonb_build_object('precedente',task.stato,'stato',p_status),auth.uid());
end $$;
revoke all on function public.workspace_customer_record_scope(),public.workspace_linked_customer_record(text,text),public.workspace_customer_entity(text,uuid),public.workspace_customer_task_status(uuid,text) from public,anon;
grant execute on function public.workspace_customer_record_scope(),public.workspace_linked_customer_record(text,text),public.workspace_customer_entity(text,uuid),public.workspace_customer_task_status(uuid,text) to authenticated;

-- Direct writes through the legacy CRM activity table must not bypass task restrictions.
create policy "customer legacy activity no insert" on public.crm_activities as restrictive for insert to authenticated with check(not public.workspace_customer_record_scope());
create policy "customer legacy activity no update" on public.crm_activities as restrictive for update to authenticated using(not public.workspace_customer_record_scope());
create policy "customer legacy activity no delete" on public.crm_activities as restrictive for delete to authenticated using(not public.workspace_customer_record_scope());

-- Customer uploads are append-only and belong to a visible task, under their own folder.
create or replace function public.workspace_customer_attachment_path(p_name text)
returns boolean language sql stable security definer set search_path=public as $$
 select split_part(p_name,'/',1)=public.workspace_current_profile_id()::text
 and split_part(p_name,'/',2)='fasi'
 and exists(select 1 from unnest(public.workspace_visible_phase_ids()) id where id::text=split_part(p_name,'/',3))
 and nullif(split_part(p_name,'/',4),'') is not null
$$;
revoke all on function public.workspace_customer_attachment_path(text) from public,anon;
grant execute on function public.workspace_customer_attachment_path(text) to authenticated;
create policy "customer task upload" on storage.objects for insert to authenticated
 with check(bucket_id='allegati' and public.workspace_customer_record_scope() and public.workspace_customer_attachment_path(name));
create policy "customer task upload boundary" on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'allegati' or not public.workspace_customer_record_scope() or public.workspace_customer_attachment_path(name));
create policy "customer attachment no overwrite" on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'allegati' or not public.workspace_customer_record_scope());
create policy "customer attachment no delete" on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'allegati' or not public.workspace_customer_record_scope());
create policy "customer attachment path boundary" on public.v4_allegati as restrictive for insert to authenticated
 with check(not public.workspace_customer_record_scope() or (public.workspace_customer_attachment_path(file_path) and split_part(file_path,'/',3)=entity_id::text));

-- The private order editor also has legacy SECURITY DEFINER confirmation RPCs.
-- Check the authenticated caller in a trigger, so these cannot bypass read-only access.
create or replace function public.workspace_customer_private_order_readonly()
returns trigger language plpgsql security definer set search_path=public as $$
declare private_order boolean;
begin
 if auth.role()='authenticated' and public.workspace_customer_record_scope() then
   if tg_table_name='ordini_testate' then
     private_order := (tg_op<>'DELETE' and new.modulo_ordini='private') or (tg_op<>'INSERT' and old.modulo_ordini='private');
   else
     select exists(select 1 from public.ordini_testate o where o.modulo_ordini='private'
       and ((tg_op<>'DELETE' and o.id=new.ordine_id) or (tg_op<>'INSERT' and o.id=old.ordine_id))) into private_order;
   end if;
   if private_order then raise exception 'Gli ordini Private sono in sola lettura per gli account cliente' using errcode='42501'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.workspace_customer_private_order_readonly() from public,anon;
create trigger customer_private_order_readonly before insert or update or delete on public.ordini_testate for each row execute function public.workspace_customer_private_order_readonly();
create trigger customer_private_order_line_readonly before insert or update or delete on public.ordini_righe for each row execute function public.workspace_customer_private_order_readonly();
notify pgrst,'reload schema';
commit;

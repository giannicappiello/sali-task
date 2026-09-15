begin;
insert into public.workspace_schermate(codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,aree,icona)
values ('produzione.revisione_priorita','Revisione priorità produzione','Anticipo lavorazioni, revisione RdP, materiali e ripianificazione coordinata.','workspace','/revisione-priorita-produzione','PriorityRevision',false,true,430,'produzione',array['produzione'],'calendar-clock')
on conflict(codice) do update set percorso=excluded.percorso,chiave_componente=excluded.chiave_componente;
insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values ('progremes','produzione.revisione_priorita',430,false,true) on conflict do nothing;
insert into public.ai_action_registry(code,system,risk_level,input_schema,required_permission,active)
values ('MES_PRIORITY_REVISE','mes','destructive','{"type":"object","required":["targetId","expectedHash","evidence"]}'::jsonb,'progremes.write',true)
on conflict(code) do update set input_schema=excluded.input_schema,active=true;

create table public.workspace_priority_revisions (
 id uuid primary key, actor uuid not null, revision_number text not null, status text not null,
 snapshot jsonb not null, created_at timestamptz not null default now(), reconciled_at timestamptz not null default now()
);
alter table public.workspace_priority_revisions enable row level security;
revoke all on public.workspace_priority_revisions from anon,authenticated;
grant all on public.workspace_priority_revisions to service_role;

-- Preflight runs before confirmation, without changing any purchasing data.
create or replace function public.check_workspace_priority_revision(p_revision jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare n jsonb; v_material_id bigint; v_confirmation_id bigint; v_requirement_id bigint;
begin
 for n in select value from jsonb_array_elements(p_revision->'snapshot'->'needs') loop
   if coalesce((n->>'internalProduction')::boolean,false) then continue; end if;
   select pm.id,cm.id into strict v_material_id,v_confirmation_id from public.workspace_v4_preview_materials pm
    join public.workspace_v4_previews p on p.id=pm.preview_id
    join public.workspace_v4_confirmation_mirrors cm on cm.preview_id=pm.preview_id
    where p.external_id=(n->>'previewExternalId')::uuid and pm.workspace_line_id=(n->>'workspaceLineId')::uuid and pm.article_code=n->>'articleCode';
   select r.id into v_requirement_id from public.workspace_v4_purchase_requirements r where r.confirmation_id=v_confirmation_id and r.preview_material_id=v_material_id;
   if (n->>'shortage')::numeric>0 and exists(select 1 from public.workspace_v4_purchase_document_lines dl where dl.requirement_id=v_requirement_id) then
     raise exception 'Il fabbisogno % ha già documenti acquisto: riconciliare gli arrivi MES prima di aumentarlo, per non duplicare gli acquisti.',v_requirement_id;
   end if;
 end loop;
exception when no_data_found or too_many_rows then
 raise exception 'Collegamento RdP/OP/materiali Workspace–MES assente o ambiguo: riconciliare prima di confermare la revisione.';
end $$;
revoke all on function public.check_workspace_priority_revision(jsonb) from public,anon,authenticated;
grant execute on function public.check_workspace_priority_revision(jsonb) to service_role;

create or replace function public.reconcile_workspace_priority_revision(p_revision jsonb,p_actor uuid)
returns void language plpgsql security definer set search_path=public as $$
declare n jsonb; m public.workspace_v4_preview_materials%rowtype; c public.workspace_v4_confirmation_mirrors%rowtype;
 r public.workspace_v4_purchase_requirements%rowtype; missing numeric; snap jsonb := p_revision->'snapshot';
begin
 if p_revision->>'status' <> 'MES_APPLIED' or not coalesce((p_revision->>'applied')::boolean,false) then raise exception 'MES_REVISION_NOT_APPLIED'; end if;
 perform pg_advisory_xact_lock(hashtext('workspace-priority-reconcile'));
 if exists(select 1 from public.workspace_priority_revisions where id=(p_revision->>'id')::uuid) then return; end if;
 perform public.check_workspace_priority_revision(p_revision);
 for n in select value from jsonb_array_elements(snap->'needs') loop
   if coalesce((n->>'internalProduction')::boolean,false) then continue; end if;
   select pm.* into strict m from public.workspace_v4_preview_materials pm
    join public.workspace_v4_previews p on p.id=pm.preview_id
    where p.external_id=(n->>'previewExternalId')::uuid and pm.workspace_line_id=(n->>'workspaceLineId')::uuid and pm.article_code=n->>'articleCode';
   select * into strict c from public.workspace_v4_confirmation_mirrors where preview_id=m.preview_id;
   missing := greatest(0,(n->>'shortage')::numeric);
   select * into r from public.workspace_v4_purchase_requirements where confirmation_id=c.id and preview_material_id=m.id for update;
   if found then
     -- Existing commercial documents are never rewritten or duplicated by a priority change.
     if exists(select 1 from public.workspace_v4_purchase_document_lines where requirement_id=r.id) then
       update public.workspace_v4_purchase_requirements set lineage=lineage || jsonb_build_object('priorityRevision',p_revision->>'id','currentUncovered',missing),updated_at=now() where id=r.id;
       if missing>0 then raise exception 'Approvvigionamento % già documentato: verificare arrivo/copertura MES prima di riallineare lo scoperto %',r.id,missing; end if;
     elsif missing=0 then
       update public.workspace_v4_purchase_requirements set status='CANCELLED',updated_at=now(),lineage=lineage || jsonb_build_object('priorityRevision',p_revision->>'id','currentUncovered',0) where id=r.id;
     else
       update public.workspace_v4_purchase_requirements set required_quantity=missing,status='OPEN',required_at=(n->>'requiredAt')::timestamptz,updated_at=now(),
         lineage=lineage || jsonb_build_object('priorityRevision',p_revision->>'id','currentUncovered',missing) where id=r.id;
     end if;
   elsif missing>0 then
     insert into public.workspace_v4_purchase_requirements(confirmation_id,preview_material_id,article_code,description,unit_of_measure,required_quantity,required_at,lineage)
     values(c.id,m.id,m.article_code,m.description,m.unit_of_measure,missing,(n->>'requiredAt')::timestamptz,
       jsonb_build_object('priorityRevision',p_revision->>'id','workspaceLineId',m.workspace_line_id,'previewExternalId',n->>'previewExternalId','calculationOwner','MES_REVISION'));
   end if;
   update public.workspace_production_requests set last_response=coalesce(last_response,'{}'::jsonb) || jsonb_build_object('priorityRevisionId',p_revision->>'id'),updated_at=now()
    where id=(select production_request_id from public.workspace_v4_previews where id=m.preview_id);
 end loop;
 insert into public.workspace_priority_revisions(id,actor,revision_number,status,snapshot,created_at)
 values((p_revision->>'id')::uuid,p_actor,p_revision->>'number','COMPLETED',snap,(p_revision->>'createdAt')::timestamptz);
end $$;
revoke all on function public.reconcile_workspace_priority_revision(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_workspace_priority_revision(jsonb,uuid) to service_role;
commit;

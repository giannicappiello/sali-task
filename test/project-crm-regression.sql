-- Run in an explicit transaction and always ROLLBACK. Fixtures never persist.
do $$
declare u public.utenti%rowtype; admin_user public.utenti%rowtype; dept uuid; other_dept uuid;
  p1 uuid:=gen_random_uuid();p2 uuid:=gen_random_uuid();p3 uuid:=gen_random_uuid();
  f1 uuid:=gen_random_uuid();f2 uuid:=gen_random_uuid();f3 uuid:=gen_random_uuid();f4 uuid:=gen_random_uuid();
  template_a uuid:=gen_random_uuid();template_b uuid:=gen_random_uuid();pt uuid:=gen_random_uuid();
begin
  select usr.* into strict u from public.utenti usr join public.ruoli r on r.id=usr.ruolo_id
  where usr.attivo and usr.auth_user_id is not null and not coalesce(r.amministratore_workspace,false)
    and coalesce(r.ambito_dati,'propri')<>'tutti' and exists(select 1 from public.utenti_reparti ur join public.reparti d on d.id=ur.reparto_id where ur.utente_id=usr.id and d.attivo)
    and not exists(select 1 from public.workspace_customer_user_links l where l.user_id=usr.id) limit 1;
  select usr.* into strict admin_user from public.utenti usr join public.ruoli r on r.id=usr.ruolo_id where usr.attivo and r.amministratore_workspace and usr.auth_user_id is not null limit 1;
  select ur.reparto_id into strict dept from public.utenti_reparti ur join public.reparti d on d.id=ur.reparto_id where ur.utente_id=u.id and d.attivo limit 1;
  select d.id into strict other_dept from public.reparti d where d.attivo and not exists(select 1 from public.utenti_reparti ur where ur.utente_id=u.id and ur.reparto_id=d.id) limit 1;
  insert into public.v4_progetti(id,titolo) values(p1,'__regression_person'),(p2,'__regression_department'),(p3,'__regression_unrelated');
  insert into public.v4_fasi_progetto(id,progetto_id,titolo,assegnato_a,reparto_id,stato) values
    (f1,p1,'__regression_assigned',u.id,null,'da_evadere'),(f2,p1,'__regression_sibling',null,other_dept,'da_evadere'),
    (f3,p2,'__regression_department',null,null,'da_evadere'),(f4,p2,'__regression_sibling_department',null,other_dept,'da_evadere');
  insert into public.v4_fase_reparti(fase_id,reparto_id,completato) values(f3,dept,false),(f2,other_dept,false),(f4,other_dept,false);
  insert into public.checklist_template(id,titolo,attivo,ordine,competenze_crm,reparto_id) values
    (template_a,'__regression_private',true,1,array['conto_terzi','b2b'],dept),(template_b,'__regression_online',true,2,array['online'],dept);
  insert into public.checklist_template_reparti(template_id,reparto_id) values(template_a,dept);
  insert into public.tipi_progetto(id,nome,attivo,competenze_crm) values(pt,'__regression_type',true,array['conto_terzi','online']);
  perform set_config('test.person',u.auth_user_id::text,true);perform set_config('test.admin',admin_user.auth_user_id::text,true);
  perform set_config('test.p1',p1::text,true);perform set_config('test.p2',p2::text,true);perform set_config('test.p3',p3::text,true);
  perform set_config('test.f1',f1::text,true);perform set_config('test.f2',f2::text,true);
  perform set_config('test.a',template_a::text,true);perform set_config('test.b',template_b::text,true);perform set_config('test.pt',pt::text,true);perform set_config('test.dept',dept::text,true);
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.person'),true);
set local role authenticated;
do $$ declare n integer; begin
  select count(*) into n from public.v4_fasi_progetto where progetto_id=current_setting('test.p1')::uuid;
  if n<>2 then raise exception 'Personal involvement must reveal BOTH phases, got %',n;end if;
  select count(*) into n from public.v4_fasi_progetto where progetto_id=current_setting('test.p2')::uuid;
  if n<>2 then raise exception 'Department involvement must reveal BOTH phases, got %',n;end if;
  if exists(select 1 from public.v4_progetti where id=current_setting('test.p3')::uuid) then raise exception 'Unrelated project leaked';end if;
  update public.v4_fasi_progetto set titolo='__not_allowed' where id=current_setting('test.f2')::uuid;
  get diagnostics n=row_count;if n<>0 then raise exception 'Sibling read access must not grant write access';end if;
  update public.v4_fasi_progetto set titolo='__allowed' where id=current_setting('test.f1')::uuid;
  get diagnostics n=row_count;if n<>1 then raise exception 'Assigned phase must remain writable';end if;
  select count(*) into n from public.v4_fase_reparti where fase_id=current_setting('test.f2')::uuid;
  if n<>1 then raise exception 'Sibling department progress hidden';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.admin'),true);
set local role authenticated;
do $$ declare r1 uuid;r2 uuid;preview jsonb;created jsonb;again jsonb;opp public.crm_opportunities%rowtype;n integer;begin
  r1:=public.workspace_save_project_rule(null,jsonb_build_object('tipo_progetto_id',current_setting('test.pt'),'template_id',current_setting('test.a'),'giorni_anticipo',3,'ordine',1,'obbligatoria',false,'durata_giorni',5,'priorita','alta'),array['conto_terzi','b2b']);
  r2:=public.workspace_save_project_rule(null,jsonb_build_object('tipo_progetto_id',current_setting('test.pt'),'template_id',current_setting('test.b'),'giorni_anticipo',1,'ordine',2,'obbligatoria',true,'durata_giorni',2,'priorita','normale','dipende_da_id',r1),array['online']);
  if not exists(select 1 from public.checklist_template_reparti where template_id=current_setting('test.a')::uuid and reparto_id=current_setting('test.dept')::uuid) then raise exception 'Department association was lost';end if;
  if not exists(select 1 from public.tipo_progetto_fasi where id=r1 and durata_giorni=5 and obbligatoria=false and giorni_anticipo=3 and priorita='alta') then raise exception 'Existing phase fields lost';end if;
  if not exists(select 1 from public.workspace_activity_catalog('b2b') where id=current_setting('test.a')::uuid) then raise exception 'Multiple competency missing';end if;
  if exists(select 1 from public.workspace_activity_catalog('b2b') where id=current_setting('test.b')::uuid or id=current_setting('test.pt')::uuid) then raise exception 'Wrong CRM catalog entry';end if;
  preview:=public.workspace_preview_operational_activity(current_setting('test.pt')::uuid,'2026-12-31',null,null,'conto_terzi');
  if (preview->>'task_count')::integer<>1 or preview->'tasks'->0->>'deadline'<>'2026-12-28' then raise exception 'Filtered preview incorrect: %',preview;end if;
  preview:=public.workspace_preview_operational_activity(current_setting('test.pt')::uuid,'2026-12-31',null,null,'online');
  if (preview->>'task_count')::integer<>1 then raise exception 'Online filter incorrect';end if;
  select o.* into strict opp from public.crm_opportunities o join public.crm_accounts a on a.id=o.account_id where a.tipo='conto_terzi' limit 1;
  created:=public.workspace_create_operational_activity(opp.account_id,opp.id,current_setting('test.pt')::uuid,'__regression_create',null,'2026-12-31',null,null,'__regression_'||current_setting('test.pt'));
  select count(*) into n from public.v4_fasi_progetto where progetto_id=(created->>'project_id')::uuid;
  if n<>1 then raise exception 'Filtered creation incorrect: %',n;end if;
  if not exists(select 1 from public.v4_fasi_progetto where progetto_id=(created->>'project_id')::uuid and obbligatoria=false and durata_giorni=5 and deadline='2026-12-28') then raise exception 'Generated phase metadata incorrect';end if;
  again:=public.workspace_create_operational_activity(opp.account_id,opp.id,current_setting('test.pt')::uuid,'__regression_create',null,'2026-12-31',null,null,'__regression_'||current_setting('test.pt'));
  if again->>'project_id'<>created->>'project_id' or again->>'idempotent'<>'true' then raise exception 'Duplicate created';end if;
  created:=public.workspace_create_operational_activity(opp.account_id,opp.id,current_setting('test.a')::uuid,'__regression_simple',null,'2026-12-31',null,null,'__regression_simple_'||current_setting('test.a'));
  if not exists(select 1 from public.v4_fase_reparti where fase_id=(created->>'task_id')::uuid and reparto_id=current_setting('test.dept')::uuid) then raise exception 'Simple task lost template department';end if;
end $$;
reset role;
select 'PASS: personal and department visibility, sibling read-only, unrelated isolation, all phase fields, additive departments, multiple CRM filters, atomic project/task creation and idempotency' result;

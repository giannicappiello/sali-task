create temp table ruoli(id uuid primary key,nome text);
create temp table reparti(id uuid primary key,nome text,attivo boolean default true);
create temp table utenti(id uuid primary key,auth_user_id uuid,nome text,cognome text,attivo boolean default true,ruolo_id uuid,reparto_id uuid);
create temp table utenti_reparti(utente_id uuid,reparto_id uuid);
create temp table chat_conversazioni(id uuid primary key default gen_random_uuid(),titolo text,tipo text,created_by uuid,created_at timestamptz default now());
create temp table chat_partecipanti(conversazione_id uuid,utente_id uuid,ultimo_letto_il timestamptz,primary key(conversazione_id,utente_id));
create temp table chat_messaggi(id uuid primary key default gen_random_uuid(),conversazione_id uuid,mittente_id uuid,messaggio text);
create temp table chat_allegati(id uuid primary key default gen_random_uuid(),conversazione_id uuid,messaggio_id uuid,caricato_da_id uuid);
create function pg_temp.current_app_user_id() returns uuid language sql as $$select auth.uid();$$;
create function pg_temp.workspace_module_enabled_for_user(uuid,text) returns boolean language sql as $$select true;$$;
insert into ruoli values ('00000000-0000-0000-0000-000000000001','Responsabile reparto'),('00000000-0000-0000-0000-000000000002','Direzione'),('00000000-0000-0000-0000-000000000003','Operatore'),('00000000-0000-0000-0000-000000000004','Admin');
insert into reparti values ('00000000-0000-0000-0000-000000000011','Produzione',true),('00000000-0000-0000-0000-000000000012','Commerciale',true),('00000000-0000-0000-0000-000000000013','Inattivo',false);
insert into utenti(id,auth_user_id,nome,cognome,ruolo_id,reparto_id) select id,id,nome,'Test',role,dept from (values
('00000000-0000-0000-0000-000000000021'::uuid,'Responsabile','00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-000000000011'::uuid),
('00000000-0000-0000-0000-000000000022','Direttore','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000012'),
('00000000-0000-0000-0000-000000000023','Collega','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000011'),
('00000000-0000-0000-0000-000000000024','Esterno','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000012'),
('00000000-0000-0000-0000-000000000025','Admin','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000011'),
('00000000-0000-0000-0000-000000000026','Multiplo','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000012')) f(id,nome,role,dept);
insert into utenti_reparti values ('00000000-0000-0000-0000-000000000026','00000000-0000-0000-0000-000000000011');
-- ASSERTIONS
do $$
declare
 manager uuid:='00000000-0000-0000-0000-000000000021'; director uuid:='00000000-0000-0000-0000-000000000022';
 colleague uuid:='00000000-0000-0000-0000-000000000023'; outsider uuid:='00000000-0000-0000-0000-000000000024';
 admin_id uuid:='00000000-0000-0000-0000-000000000025'; multiple uuid:='00000000-0000-0000-0000-000000000026';
 production uuid:='00000000-0000-0000-0000-000000000011'; sales uuid:='00000000-0000-0000-0000-000000000012';
 direct_id uuid; group_id uuid; own_id uuid; msg uuid; directory jsonb;
begin
 perform set_config('request.jwt.claim.sub',manager::text,true);
 assert pg_temp.chat_pair_allowed(manager,director),'leaders across departments';
 assert pg_temp.chat_pair_allowed(colleague,multiple),'additional membership';
 assert not pg_temp.chat_pair_allowed(colleague,director),'collaborator cannot contact foreign leader';
 assert not pg_temp.chat_pair_allowed(manager,outsider),'leader cannot contact foreign collaborator';
 assert not pg_temp.chat_pair_allowed(admin_id,director),'admin has no leadership bypass';
 directory:=pg_temp.chat_directory();
 assert not exists(select 1 from jsonb_array_elements(directory->'users') u where u->>'id'=outsider::text),'directory omits foreign collaborators';
 assert exists(select 1 from jsonb_array_elements(directory->'users') u where u->>'id'=multiple::text),'directory includes additional department';
 direct_id:=pg_temp.chat_create_direct(director);
 assert pg_temp.chat_create_direct(director)=direct_id,'direct idempotency';
 group_id:=pg_temp.chat_create_department_group('ignored',array[sales]);
 assert (select count(*) from pg_temp.chat_partecipanti where conversazione_id=group_id)=2,'foreign department includes leadership only';
 own_id:=pg_temp.chat_create_department_group('ignored',array[production]);
 assert (select count(*) from pg_temp.chat_partecipanti where conversazione_id=own_id)=4,'own department includes all active members';
 assert pg_temp.chat_can_send(direct_id),'allowed direct send';
 begin perform pg_temp.chat_create_people_group('Mixed',array[colleague,director]); raise exception 'mixed group accepted'; exception when insufficient_privilege then null; end;
 begin perform pg_temp.chat_create_direct(outsider); raise exception 'foreign collaborator accepted'; exception when insufficient_privilege then null; end;
 insert into pg_temp.chat_messaggi(conversazione_id,mittente_id,messaggio) values(direct_id,manager,'test') returning id into msg;
 insert into pg_temp.chat_allegati(conversazione_id,messaggio_id,caricato_da_id) values(direct_id,msg,manager);
 perform set_config('request.jwt.claim.sub',colleague::text,true);
 begin perform pg_temp.chat_create_department_group('Sales',array[sales]); raise exception 'foreign department accepted'; exception when insufficient_privilege then null; end;
 begin insert into pg_temp.chat_messaggi(conversazione_id,mittente_id,messaggio) values(direct_id,colleague,'test'); raise exception 'outsider message accepted'; exception when insufficient_privilege then null; end;
 begin insert into pg_temp.chat_messaggi(conversazione_id,mittente_id,messaggio) values(own_id,manager,'spoof'); raise exception 'spoof accepted'; exception when insufficient_privilege then null; end;
 begin update pg_temp.chat_partecipanti set conversazione_id=direct_id where conversazione_id=own_id and utente_id=colleague; raise exception 'membership move accepted'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',manager::text,true);
 begin insert into pg_temp.chat_partecipanti(conversazione_id,utente_id) values(direct_id,colleague); raise exception 'mixed participant insert accepted'; exception when insufficient_privilege then null; end;
 update pg_temp.utenti set ruolo_id='00000000-0000-0000-0000-000000000003' where id=director;
 assert not pg_temp.chat_can_send(direct_id),'role change locks old chat';
 begin insert into pg_temp.chat_messaggi(conversazione_id,mittente_id,messaggio) values(direct_id,manager,'blocked'); raise exception 'legacy send accepted'; exception when insufficient_privilege then null; end;
 begin insert into pg_temp.chat_allegati(conversazione_id,messaggio_id,caricato_da_id) values(direct_id,msg,manager); raise exception 'legacy attachment accepted'; exception when insufficient_privilege then null; end;
 assert (select count(*) from pg_temp.chat_messaggi where conversazione_id=direct_id)=1,'history preserved';
 update pg_temp.utenti set attivo=false where id=colleague;
 assert not pg_temp.chat_pair_allowed(manager,colleague),'inactive colleague denied';
end $$;
select 'Chat permissions, directory, groups, legacy writes and attachments verified' as result;

-- Run after the migration in a rollback-only verification transaction.
-- Clone only the rule evaluator against isolated fixtures, never edit real users.
create temporary table utenti(id uuid,auth_user_id uuid,ruolo_id uuid,attivo boolean);
create temporary table reparti(id uuid,attivo boolean);
create temporary table utenti_reparti(utente_id uuid,reparto_id uuid);
create temporary table workspace_customer_user_links(user_id uuid);
create temporary table workspace_commercial_read_rules(role_id uuid,department_id uuid);
do $test$
declare definition text; object_name text;
begin
 definition:=pg_get_functiondef('public.workspace_commercial_read_all()'::regprocedure);
 foreach object_name in array array['workspace_commercial_read_all','workspace_commercial_read_rules',
   'workspace_customer_user_links','utenti_reparti','utenti','reparti'] loop
   definition:=replace(definition,'public.'||object_name,'pg_temp.'||object_name);
 end loop;
 execute definition;
 insert into pg_temp.utenti values(md5('user')::uuid,auth.uid(),md5('director')::uuid,true);
 insert into pg_temp.reparti values(md5('marketing')::uuid,true),(md5('communications')::uuid,true),(md5('field')::uuid,true);
 insert into pg_temp.workspace_commercial_read_rules values
   (md5('director')::uuid,md5('marketing')::uuid),(md5('director')::uuid,md5('communications')::uuid);
 insert into pg_temp.utenti_reparti values(md5('user')::uuid,md5('marketing')::uuid);
 if not pg_temp.workspace_commercial_read_all() then raise exception 'Marketing director denied'; end if;
 update pg_temp.utenti set ruolo_id=md5('manager')::uuid;
 if pg_temp.workspace_commercial_read_all() then raise exception 'Department manager allowed'; end if;
 update pg_temp.utenti set ruolo_id=md5('director')::uuid;
 update pg_temp.utenti_reparti set reparto_id=md5('field')::uuid;
 if pg_temp.workspace_commercial_read_all() then raise exception 'Field Force director allowed globally'; end if;
 update pg_temp.utenti_reparti set reparto_id=md5('communications')::uuid;
 if not pg_temp.workspace_commercial_read_all() then raise exception 'Communications director denied'; end if;
 update pg_temp.reparti set attivo=false;
 if pg_temp.workspace_commercial_read_all() then raise exception 'Inactive department retained access'; end if;
 update pg_temp.reparti set attivo=true;
 delete from pg_temp.utenti_reparti;
 if pg_temp.workspace_commercial_read_all() then raise exception 'Removed membership retained access'; end if;
 insert into pg_temp.utenti_reparti values(md5('user')::uuid,md5('marketing')::uuid);
 insert into pg_temp.workspace_customer_user_links values(md5('user')::uuid);
 if pg_temp.workspace_commercial_read_all() then raise exception 'Linked customer scope escaped'; end if;
 delete from pg_temp.workspace_customer_user_links;
 update pg_temp.utenti set attivo=false;
 if pg_temp.workspace_commercial_read_all() then raise exception 'Disabled user retained access'; end if;
end $test$;

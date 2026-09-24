-- Extends the disposable fixture only; never run on a Workspace database.
create schema auth;
create function auth.uid() returns uuid language sql as $$select workspace_current_profile_id()$$;
alter table ruoli add column livello_ai text default 'analisi';
alter table utenti add column auth_user_id uuid, add column reparto_id uuid;
update utenti set auth_user_id=id, reparto_id='30000000-0000-4000-8000-000000000001';
update ruoli set amministratore_workspace=false;
create table utenti_reparti(utente_id uuid,reparto_id uuid);
create table workspace_moduli(codice text,attivo boolean);
create table ai_reparti_moduli(reparto_id uuid,modulo_codice text,consentito boolean);
create table ai_utenti_moduli(utente_id uuid,modulo_codice text,consentito boolean);
create table ai_utilizzo_mensile(utente_id uuid,mese date,richieste int,costo_usd numeric);
create table ai_reparti_capacita(reparto_id uuid,dati_interni boolean,ricerca_web boolean,ordini boolean,progremes boolean,pianificazione boolean,applicazione_piani boolean,riconoscimento_immagini boolean,limite_richieste_mese int,limite_spesa_utente_mese_usd numeric,limite_documenti_giorno int,massimo_pagine_documento int,costo_massimo_operazione_usd numeric);
create function workspace_module_enabled_for_user(uuid,text) returns boolean language sql as $$select $2 <> 'crm_online'$$;
insert into workspace_moduli values('human_resources',true),('crm_b2b',true),('crm_online',true);
insert into ai_reparti_moduli values('30000000-0000-4000-8000-000000000001','human_resources',true),('30000000-0000-4000-8000-000000000001','crm_online',true);

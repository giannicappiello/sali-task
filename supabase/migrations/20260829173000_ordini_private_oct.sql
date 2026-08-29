begin;

-- OrdiniPrivate is a third, independent orders area. Existing PR/PH rows and
-- Mexal documents remain untouched.
alter table public.ordini_testate add column if not exists numero_oct text;

do $$
declare item record;
begin
  for item in
    select conname
    from pg_constraint
    where conrelid='public.ordini_testate'::regclass
      and contype='c'
      and pg_get_constraintdef(oid) ilike '%modulo_ordini%'
  loop execute format('alter table public.ordini_testate drop constraint %I', item.conname); end loop;
end $$;
alter table public.ordini_testate
  add constraint ordini_testate_modulo_ordini_check check (modulo_ordini in ('prof','ph','private'));

do $$
declare item record;
begin
  for item in
    select conname
    from pg_constraint
    where conrelid='public.ordini_moduli_configurazione'::regclass
      and contype='c'
      and pg_get_constraintdef(oid) ilike '%modulo_ordini%'
  loop execute format('alter table public.ordini_moduli_configurazione drop constraint %I', item.conname); end loop;
end $$;
alter table public.ordini_moduli_configurazione
  add constraint ordini_moduli_configurazione_modulo_check check (modulo_ordini in ('prof','ph','private'));

alter table public.ordini_documenti_mexal drop constraint if exists ordini_documenti_mexal_tipo_documento_check;
alter table public.ordini_documenti_mexal
  add constraint ordini_documenti_mexal_tipo_documento_check check (tipo_documento in ('OCM','OCX','OCI','OCT'));
alter table public.ordini_documenti_mexal drop constraint if exists ordini_documenti_mexal_modulo_check;
alter table public.ordini_documenti_mexal
  add constraint ordini_documenti_mexal_modulo_check check (modulo in ('ORDINIPH','ORDINIPR','ORDINIPRIVATE'));

alter table public.ordini_sync_mexal_log drop constraint if exists ordini_sync_mexal_log_tipo_documento_check;
alter table public.ordini_sync_mexal_log
  add constraint ordini_sync_mexal_log_tipo_documento_check check (tipo_documento in ('OCM','OCX','OCI','OCT'));

do $$
begin
  if to_regclass('public.ai_ordini_acquisizioni') is not null then
    alter table public.ai_ordini_acquisizioni drop constraint if exists ai_ordini_acquisizioni_modulo_codice_check;
    alter table public.ai_ordini_acquisizioni add constraint ai_ordini_acquisizioni_modulo_codice_check
      check (modulo_codice in ('ordini_pr','ordini_ph','ordini_private'));
  end if;
end $$;

insert into public.ordini_moduli_configurazione (modulo_ordini,invia_automaticamente_mexal)
values ('private',false)
on conflict (modulo_ordini) do nothing;

insert into public.workspace_moduli
  (codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,assegnabile_reparto,livello_self_service,dipendenze,protetto,configurabile_ruolo,mostra_menu,attivo,ordine,icona,aggiornato_il)
values
  ('ordini_private','OrdiniPrivate','Creazione e invio di ordini cliente OCT a Mexal.','contenitore','commerciale','/ordini-private','workspace',false,true,null,'{}',false,true,true,true,55,'shopping-cart',now())
on conflict (codice) do update set
  nome=excluded.nome,descrizione=excluded.descrizione,tipo=excluded.tipo,area=excluded.area,
  percorso=excluded.percorso,provider=excluded.provider,assegnabile_reparto=true,
  configurabile_ruolo=true,mostra_menu=true,attivo=true,ordine=excluded.ordine,
  icona=excluded.icona,aggiornato_il=now();

insert into public.workspace_schermate
  (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,metadati,ultima_sincronizzazione)
values
  ('ordini_private.dashboard','Dashboard OrdiniPrivate','Indicatori e riepilogo operativo degli OCT Private.','workspace','/ordini-private/dashboard','orders.private.dashboard',false,true,280,'{"required_module":"ordini_private","allowed_page":"dashboard"}'::jsonb,now()),
  ('ordini_private.clienti','Clienti OrdiniPrivate','Clienti disponibili per la creazione degli OCT.','workspace','/ordini-private/clienti','orders.private.customers',false,true,290,'{"required_module":"ordini_private","allowed_page":"customers"}'::jsonb,now()),
  ('ordini_private.ordini','OrdiniPrivate','Elenco, consultazione e gestione degli OCT Private.','workspace','/ordini-private/elenco','orders.private.orders',false,true,300,'{"required_module":"ordini_private","allowed_page":"orders"}'::jsonb,now()),
  ('ordini_private.fatture','Fatture OrdiniPrivate','Consultazione fatture collegata al modulo OrdiniPrivate.','workspace','/ordini-private/fatture','orders.private.invoices',false,true,310,'{"required_module":"ordini_private","allowed_page":"invoices"}'::jsonb,now()),
  ('integrazioni.ordini_private','Configurazione OrdiniPrivate','Invio OCT a Mexal, serie, automazioni e destinatari email degli OrdiniPrivate.','workspace','/integrations/orders/private','integrations.orders_private',false,true,955,'{"required_permissions":["integrations.configure"]}'::jsonb,now())
on conflict (codice) do update set
  nome=excluded.nome,descrizione=excluded.descrizione,provider=excluded.provider,
  percorso=excluded.percorso,chiave_componente=excluded.chiave_componente,
  attiva=true,ordine=excluded.ordine,metadati=workspace_schermate.metadati || excluded.metadati,
  ultima_sincronizzazione=now();

insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values
  ('ordini_private','ordini_private.dashboard',10,false,true),
  ('ordini_private','ordini_private.clienti',20,false,true),
  ('ordini_private','ordini_private.ordini',30,false,true),
  ('ordini_private','ordini_private.fatture',40,false,true),
  ('integrazioni','integrazioni.ordini_private',55,false,true)
on conflict (modulo_codice,schermata_codice) do update set ordine=excluded.ordine,visibile_menu=true;

insert into public.workspace_menu_voci(codice,nome,descrizione,icona,ordine,attiva,aggiornata_il)
values ('ordini_private','OrdiniPrivate','Creazione e invio di OCT a Mexal.','shopping-cart',55,true,now())
on conflict (codice) do update set nome=excluded.nome,descrizione=excluded.descrizione,icona=excluded.icona,ordine=excluded.ordine,attiva=true,aggiornata_il=now();
insert into public.workspace_menu_moduli(voce_codice,modulo_codice,ordine)
values ('ordini_private','ordini_private',10)
on conflict (voce_codice,modulo_codice) do update set ordine=10;

-- The new module starts with the same organizational grants as PH, while
-- remaining independently configurable afterwards.
insert into public.ruoli_moduli(ruolo_id,modulo,livello_accesso,aggiornato_il)
select ruolo_id,'ordini_private',livello_accesso,now() from public.ruoli_moduli where modulo='ordini_ph'
on conflict (ruolo_id,modulo) do nothing;
insert into public.reparti_moduli(reparto_id,modulo)
select reparto_id,'ordini_private' from public.reparti_moduli where modulo='ordini_ph'
on conflict (reparto_id,modulo) do nothing;
insert into public.integrazioni_utenti(utente_id,modulo,enabled,ruolo_ordini,codice_agente_mexal,agenti_gestiti,updated_at)
select utente_id,'gestione_ordini_private',enabled,ruolo_ordini,codice_agente_mexal,agenti_gestiti,now()
from public.integrazioni_utenti where modulo='gestione_ordini_ph'
on conflict (utente_id,modulo) do nothing;
insert into public.ai_reparti_moduli(reparto_id,modulo_codice,livello,riconoscimento_immagini,consentito,aggiornato_da,aggiornato_il)
select reparto_id,'ordini_private',livello,riconoscimento_immagini,consentito,aggiornato_da,now()
from public.ai_reparti_moduli where modulo_codice='ordini_ph'
on conflict (reparto_id,modulo_codice) do nothing;
insert into public.ai_utenti_moduli(utente_id,modulo_codice,livello,riconoscimento_immagini,consentito,aggiornato_da,aggiornato_il)
select utente_id,'ordini_private',livello,riconoscimento_immagini,consentito,aggiornato_da,now()
from public.ai_utenti_moduli where modulo_codice='ordini_ph'
on conflict (utente_id,modulo_codice) do nothing;

commit;

begin;

-- Enforce the document contract for every new or updated row without
-- invalidating historical records that predate explicit module ownership.
alter table public.ordini_documenti_mexal
  drop constraint if exists ordini_documenti_mexal_module_document_contract_check;
alter table public.ordini_documenti_mexal
  add constraint ordini_documenti_mexal_module_document_contract_check
  check (
    modulo is null
    or (modulo in ('ORDINIPR','ORDINIPH') and tipo_documento in ('OCM','OCX','OCI'))
    or (modulo = 'ORDINIPRIVATE' and tipo_documento = 'OCT')
  ) not valid;

-- Repair the navigable OrdiniPrivate screens idempotently. Fatture remains a
-- first-class section alongside Dashboard, Clienti and Ordini.
insert into public.workspace_schermate
  (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,metadati,ultima_sincronizzazione)
values
  ('ordini_private.dashboard','Dashboard OrdiniPrivate','Indicatori e riepilogo operativo degli OCT Private.','workspace','/ordini-private/dashboard','orders.private.dashboard',false,true,280,'{"required_module":"ordini_private","allowed_page":"dashboard"}'::jsonb,now()),
  ('ordini_private.clienti','Clienti OrdiniPrivate','Clienti disponibili per la creazione degli OCT.','workspace','/ordini-private/clienti','orders.private.customers',false,true,290,'{"required_module":"ordini_private","allowed_page":"customers"}'::jsonb,now()),
  ('ordini_private.ordini','OrdiniPrivate','Elenco, consultazione e gestione degli OCT Private.','workspace','/ordini-private/elenco','orders.private.orders',false,true,300,'{"required_module":"ordini_private","allowed_page":"orders"}'::jsonb,now()),
  ('ordini_private.fatture','Fatture OrdiniPrivate','Consultazione fatture collegata al modulo OrdiniPrivate.','workspace','/ordini-private/fatture','orders.private.invoices',false,true,310,'{"required_module":"ordini_private","allowed_page":"invoices"}'::jsonb,now())
on conflict (codice) do update set
  nome=excluded.nome,
  descrizione=excluded.descrizione,
  provider=excluded.provider,
  percorso=excluded.percorso,
  chiave_componente=excluded.chiave_componente,
  attiva=true,
  ordine=excluded.ordine,
  metadati=workspace_schermate.metadati || excluded.metadati,
  ultima_sincronizzazione=now();

insert into public.workspace_moduli_schermate
  (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values
  ('ordini_private','ordini_private.dashboard',10,true,true),
  ('ordini_private','ordini_private.clienti',20,false,true),
  ('ordini_private','ordini_private.ordini',30,false,true),
  ('ordini_private','ordini_private.fatture',40,false,true)
on conflict (modulo_codice,schermata_codice) do update set
  ordine=excluded.ordine,
  predefinita=excluded.predefinita,
  visibile_menu=true;

commit;

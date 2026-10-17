begin;
create table public.club_documents (
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('program','privacy')),
 title text not null check(length(btrim(title)) between 1 and 200),body text not null check(length(body) between 30 and 50000),
 status text not null default 'draft' check(status in ('draft','published')),
 created_by uuid not null references public.utenti(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),published_at timestamptz
);
alter table public.club_documents enable row level security;
revoke all on public.club_documents from public,anon,authenticated;
grant all on public.club_documents to service_role;
alter table public.club_public_settings drop constraint club_public_settings_privacy_url_check,drop constraint club_public_settings_terms_url_check;
alter table public.club_public_settings add constraint club_public_settings_privacy_url_check check(privacy_url is null or privacy_url ~ '^/regolamento\?documento=privacy&version=[a-f0-9-]+$'),add constraint club_public_settings_terms_url_check check(terms_url is null or terms_url ~ '^/regolamento\?documento=program&version=[a-f0-9-]+$');
insert into public.workspace_schermate(codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,icona,metadati,ultima_sincronizzazione)
values('crm.online.club.regolamento','Club · Regolamento e privacy','Documenti del Club, versioni e pubblicazione.','workspace','/crm/online/salidischiaclub/regolamento','crm.club.regolamento',false,true,496,'crm','clipboard','{"crm_area":"SalidischiaClub","parent_path":"/crm/online"}',now());
insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu) values('crm_online','crm.online.club.regolamento',496,false,true);

create function public.club_public_document(document_kind text,document_version uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if document_kind not in ('program','privacy') then raise exception 'Documento non disponibile.';end if;
 return (select jsonb_build_object('id',id,'kind',kind,'title',title,'body',body,'published_at',published_at) from public.club_documents
 where kind=document_kind and status='published' and (document_version is null or id=document_version) order by published_at desc,id limit 1);
end $$;
create function public.club_admin_documents() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform public.club_require_staff('regolamento');
 return coalesce((select jsonb_agg(to_jsonb(d) order by created_at desc,id) from public.club_documents d),'[]');
end $$;
create function public.club_save_document(document_kind text,document_title text,document_body text,target_id uuid default null,expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare current_row public.club_documents;document_id uuid;begin
 perform public.club_require_staff('regolamento','scrittura');
 if target_id is not null then
  select * into current_row from public.club_documents where id=target_id for update;
  if not found or current_row.status<>'draft' then raise exception 'La versione pubblicata non è modificabile. Crea una nuova bozza.';end if;
  if expected_updated_at is null or current_row.updated_at<>expected_updated_at then raise exception 'La bozza è cambiata. Ricarica prima di salvare.' using errcode='40001';end if;
 end if;
 insert into public.club_documents(id,kind,title,body,created_by,updated_at) values(coalesce(target_id,gen_random_uuid()),document_kind,btrim(document_title),document_body,public.workspace_current_profile_id(),clock_timestamp())
 on conflict(id) do update set kind=excluded.kind,title=excluded.title,body=excluded.body,updated_at=excluded.updated_at returning id into document_id;
 perform public.club_audit_event('DOCUMENT_SAVED',document_id);return document_id;
end $$;
create function public.club_publish_document(target_id uuid,expected_updated_at timestamptz) returns void language plpgsql security definer set search_path=public as $$
declare document public.club_documents;begin
 perform public.club_require_staff('regolamento','amministrazione');
 perform pg_advisory_xact_lock(hashtext('salidischiaclub.documents'));
 select * into document from public.club_documents where id=target_id for update;
 if not found then raise exception 'Documento non trovato.';end if;
 if document.status='published' then return;end if;
 if expected_updated_at is null or document.updated_at<>expected_updated_at then raise exception 'La bozza è cambiata. Ricarica prima di pubblicare.' using errcode='40001';end if;
 if document.body ~ '\[\[[^]]*\]\]' then raise exception 'Completa i campi tra doppie parentesi prima della pubblicazione.';end if;
 update public.club_documents set status='published',published_at=now(),updated_at=clock_timestamp() where id=target_id;
 update public.club_public_settings set privacy_url=case when document.kind='privacy' then '/regolamento?documento=privacy&version='||target_id else privacy_url end,
 terms_url=case when document.kind='program' then '/regolamento?documento=program&version='||target_id else terms_url end,updated_at=clock_timestamp() where id;
 perform public.club_audit_event('DOCUMENT_PUBLISHED',target_id,jsonb_build_object('kind',document.kind));
end $$;
create or replace function public.club_admin_public_settings(payload jsonb) returns void language plpgsql security definer set search_path=public as $$
begin perform public.club_require_staff('negozi','amministrazione');
 if not exists(select 1 from public.utenti u join public.ruoli r on r.id=u.ruolo_id where u.id=(payload->>'crm_owner_id')::uuid and u.attivo is not false and r.amministratore_workspace) then raise exception 'Seleziona un responsabile CRM amministratore.';end if;
 if length(coalesce(payload->>'support_email',''))>254 or (coalesce(payload->>'support_email','')<>'' and payload->>'support_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Email assistenza non valida.';end if;
 update public.club_public_settings set crm_owner_id=(payload->>'crm_owner_id')::uuid,support_email=coalesce(payload->>'support_email',''),updated_at=clock_timestamp() where id;
 perform public.club_audit_event('PUBLIC_SETTINGS_UPDATED',(payload->>'crm_owner_id')::uuid);
end $$;

-- Consent must refer to the version actually displayed to the member.
alter function public.club_enroll_member(text,text,boolean,boolean,boolean) rename to club_enroll_member_impl;
revoke all on function public.club_enroll_member_impl(text,text,boolean,boolean,boolean) from public,anon,authenticated;
create function public.club_enroll_member(display_name text,phone_number text,accept_program boolean,marketing boolean,profiling boolean,expected_terms_url text,expected_privacy_url text)
returns uuid language plpgsql security definer set search_path=public as $$
declare settings public.club_public_settings;begin
 select * into settings from public.club_public_settings where id;
 if expected_terms_url is null or expected_privacy_url is null or settings.terms_url is distinct from expected_terms_url or settings.privacy_url is distinct from expected_privacy_url then raise exception 'I documenti del Club sono stati aggiornati. Ricarica e leggili prima di proseguire.';end if;
 return public.club_enroll_member_impl(display_name,phone_number,accept_program,marketing,profiling);
end $$;
alter function public.club_update_consents(boolean,boolean) rename to club_update_consents_impl;
revoke all on function public.club_update_consents_impl(boolean,boolean) from public,anon,authenticated;
create function public.club_update_consents(marketing boolean,profiling boolean,expected_privacy_url text) returns void language plpgsql security definer set search_path=public as $$
begin
 if (marketing or profiling) and (expected_privacy_url is null or not exists(select 1 from public.club_public_settings where id and privacy_url=expected_privacy_url)) then raise exception 'Informativa aggiornata. Ricarica e leggila prima di confermare.';end if;
 perform public.club_update_consents_impl(marketing,profiling);
end $$;

-- Public documents are the only additional anonymous endpoint.
do $$declare original text;revised text;begin
 select pg_get_functiondef('public.club_api_boundary()'::regprocedure) into original;
 revised:=replace(original,'''/rpc/club_public_info''','''/rpc/club_public_info'',''/rpc/club_public_document''');
 if revised=original then raise exception 'Unexpected Club API boundary.';end if;execute revised;
end $$;
revoke all on function public.club_public_document(text,uuid),public.club_admin_documents(),public.club_save_document(text,text,text,uuid,timestamptz),public.club_publish_document(uuid,timestamptz),public.club_enroll_member(text,text,boolean,boolean,boolean,text,text),public.club_update_consents(boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.club_public_document(text,uuid) to anon,authenticated;
grant execute on function public.club_admin_documents(),public.club_save_document(text,text,text,uuid,timestamptz),public.club_publish_document(uuid,timestamptz),public.club_enroll_member(text,text,boolean,boolean,boolean,text,text),public.club_update_consents(boolean,boolean,text) to authenticated;

-- Initial documents stay in draft. Square-bracket fields require real company decisions.
insert into public.club_documents(kind,title,body,created_by)
select source.kind,source.title,source.body,u.id from (values
('program','Regolamento Sali di Ischia Club',
$program$# Sali di Ischia Club

## Promotore e contatti
PROGRÈ SRL, Via Campo di Fiume 10, 83030 Montefredane (AV), Italia.
Recapito per il programma: [[EMAIL ASSISTENZA CLUB]].
Durata e ambito territoriale: [[PERIODO E TERRITORIO DEL PROGRAMMA]].

## Iscrizione
Il Club è dedicato ai consumatori che creano un account, confermano l’indirizzo email e accettano il presente regolamento. Requisiti di partecipazione: [[REQUISITI E LIMITI DI ETÀ]]. I consensi a marketing e profilazione sono facoltativi e separati dall’adesione.

## Negozio di fiducia
Ogni cliente sceglie un solo negozio aderente alla volta. Il negozio può vedere e gestire soltanto i clienti che lo hanno scelto. Il cambio negozio aggiorna immediatamente tale accesso; le richieste già inviate conservano il negozio indicato al momento della richiesta e sono gestite dall’assistenza se necessario.

## Accumulo del cashback
Gli acquisti validi sono registrati dal negoziante con prodotti, quantità e importi effettivamente pagati. La percentuale in vigore è indicata nell’app. Il budget è calcolato sul totale valido della transazione e arrotondato al centesimo. Le modifiche successive non ricalcolano gli acquisti precedenti.

## Premi e utilizzo del budget
L’app mostra i prodotti, i premi e le eventuali modalità di rimborso disponibili secondo le regole pubblicate. Prima della conferma sono indicati budget necessario, modalità di consegna e costi. L’invio riserva il budget; l’utilizzo definitivo avviene alla consegna o alla registrazione del pagamento. Le richieste sono soggette alla verifica del promotore. L’eventuale rimborso monetario deve essere disciplinato e validato in relazione alla qualificazione giuridica del programma prima dell’abilitazione.

## Ritiro e spedizione
Il ritiro avviene nel negozio indicato nella richiesta, dopo approvazione e verifica del codice di ritiro. La spedizione, quando disponibile, avviene all’indirizzo confermato dal cliente. Costi ed eventuali soglie di gratuità sono mostrati prima della richiesta. Termini massimi di consegna e gestione dei disservizi: [[TEMPI DI CONSEGNA E ASSISTENZA]].

## Annullamenti, resi e scadenze
Le richieste non ancora spedite o concluse possono essere annullate nei casi consentiti dall’app, liberando il budget. I resi comportano lo storno tracciato del cashback; se già riservato o utilizzato, occorre rivolgersi all’assistenza. Validità del budget e condizioni alla chiusura del programma: [[SCADENZE E TRATTAMENTO DEL BUDGET RESIDUO]].

## Dati personali
L’informativa privacy del Club è disponibile nella stessa sezione Regolamento. La versione accettata e gli eventi rilevanti sono conservati nello storico del programma.$program$),
('privacy','Informativa privacy Sali di Ischia Club',
$privacy$# Informativa privacy del Club

## Titolare e contatti
Titolare del trattamento: PROGRÈ SRL, Via Campo di Fiume 10, 83030 Montefredane (AV), Italia. Contatto privacy: [[RECAPITO PRIVACY]]. Eventuale responsabile della protezione dei dati: [[DPO O INDICAZIONE NON DESIGNATO]].

## Dati trattati e finalità
Il Club tratta dati di account e identificazione, negozio di fiducia, prodotti e importi acquistati, budget cashback, richieste di premi, consegne e preferenze. L’indirizzo è richiesto per la spedizione; i dati di pagamento sono richiesti solo per la modalità di rimborso prescelta. Account, autenticazione, operazioni e controlli tecnici servono al funzionamento e alla sicurezza del programma.

## Basi giuridiche e conferimento
L’adesione comporta i trattamenti necessari all’esecuzione del programma. Marketing e profilazione richiedono scelte separate e facoltative, modificabili dal profilo. Ulteriori basi giuridiche, obblighi e conseguenze del mancato conferimento: [[BASI GIURIDICHE SPECIFICHE E OBBLIGHI]].

## Accesso dei negozi e destinatari
Il negozio di fiducia corrente accede ai soli dati operativi necessari per identificare il cliente, registrare gli acquisti e consegnare i premi autorizzati. Dopo il cambio negozio perde l’accesso al cliente. L’amministrazione aziendale conserva lo storico nel CRM. Categorie e ruoli degli altri destinatari, fornitori e responsabili, inclusi eventuali incaricati delle spedizioni o pagamenti: [[DESTINATARI E RESPONSABILI]].

## Conservazione e trasferimenti
Periodi o criteri di conservazione per account, acquisti, audit e consensi: [[TEMPI O CRITERI DI CONSERVAZIONE]]. Localizzazione dei servizi ed eventuali trasferimenti fuori dallo Spazio economico europeo e relative garanzie: [[LOCALIZZAZIONE E TRASFERIMENTI]].

## Diritti e preferenze
Nei casi previsti dalla normativa, puoi chiedere accesso, rettifica, cancellazione, limitazione e portabilità e opporti ai trattamenti applicabili. Puoi revocare i consensi facoltativi dal profilo. Per le altre richieste usa il contatto privacy sopra indicato. Puoi presentare reclamo al Garante per la protezione dei dati personali.

## Profilazione e strumenti tecnici
L’app usa la sessione di autenticazione e strumenti tecnici necessari al servizio. Le preferenze di marketing e profilazione sono registrate separatamente. Descrizione delle eventuali attività di profilazione effettivamente svolte e di decisioni automatizzate, se presenti: [[PROFILAZIONE E DECISIONI AUTOMATIZZATE]].$privacy$)
) source(kind,title,body) cross join lateral(select u.id from public.utenti u join public.ruoli r on r.id=u.ruolo_id where u.attivo is not false and r.amministratore_workspace order by u.id limit 1) u;
notify pgrst,'reload schema';
commit;

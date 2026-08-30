begin;

-- Documenti Direct è un modulo operativo: gli amministratori lo vedono sempre,
-- gli altri utenti soltanto quando il loro reparto lo ha ricevuto.
-- Il record resta protetto da cancellazione/disattivazione; l'unica eccezione
-- ammessa è la nuova disponibilità per reparto del modulo documenti.
create or replace function public.protect_workspace_catalog_records()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and old.protetto then
    raise exception 'Il modulo % è protetto e non può essere eliminato.', old.codice;
  end if;
  if tg_op = 'UPDATE' and old.protetto and (
    new.attivo is false
    or (new.sempre_disponibile is false and old.codice <> 'documenti')
  ) then
    raise exception 'Il modulo % deve restare attivo e disponibile.', old.codice;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

update public.workspace_moduli
set nome = 'Documenti Direct',
    descrizione = 'Archivio documentale Direct assegnabile ai reparti autorizzati.',
    sempre_disponibile = false,
    assegnabile_reparto = true,
    configurabile_ruolo = true,
    aggiornato_il = now()
where codice = 'documenti';

update public.workspace_schermate
set nome = 'Documenti Direct',
    descrizione = 'Archivio documentale Direct riservato ai reparti autorizzati.',
    aggiornato_il = now()
where codice = 'documenti' or percorso = '/documentation';

drop policy if exists "active users read workspace documents" on public.documenti_workspace;
drop policy if exists "authorized departments read workspace documents" on public.documenti_workspace;
create policy "authorized departments read workspace documents"
on public.documenti_workspace for select to authenticated
using (
  attivo
  and exists (
    select 1
    from public.utenti current_user_profile
    where current_user_profile.auth_user_id = auth.uid()
      and current_user_profile.attivo is not false
      and public.workspace_module_enabled_for_user(current_user_profile.id, 'documenti')
  )
);

-- Un cliente canonico resta una sola anagrafica Mexal. La funzione crea soltanto
-- l'estensione CRM 1:1 necessaria per attività, opportunità e brief.
create or replace function public.crm_ensure_canonical_account(
  p_customer_code text,
  p_crm_type text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid := public.workspace_current_profile_id();
  customer_record record;
  account_id uuid;
begin
  if p_crm_type not in ('conto_terzi', 'b2b', 'online') then
    raise exception 'Area CRM non valida.' using errcode = '22023';
  end if;
  if current_profile_id is null
    or not public.crm_has_module_level(public.crm_module_for_type(p_crm_type), 'scrittura') then
    raise exception 'Permesso CRM di scrittura richiesto.' using errcode = '42501';
  end if;

  select customer.codice_cliente, customer.ragione_sociale, customer.partita_iva,
         customer.codice_fiscale, customer.email, customer.telefono, customer.indirizzo,
         customer.localita, customer.provincia, customer.cap
  into customer_record
  from public.ordini_clienti_cache customer
  join public.crm_customer_classifications classification
    on classification.codice_cliente = customer.codice_cliente
   and classification.area_crm::text = p_crm_type
  where customer.codice_cliente = btrim(p_customer_code)
    and customer.attivo_mexal is true
    and public.crm_customer_classification_visible(classification.codice_cliente, classification.area_crm)
  limit 1;

  if customer_record.codice_cliente is null then
    raise exception 'Cliente canonico non trovato o non autorizzato.' using errcode = 'P0002';
  end if;

  insert into public.crm_accounts (
    tipo, nome, stato, responsabile_id, codice_cliente_mexal, fonte,
    partita_iva, codice_fiscale, email, telefono, indirizzo, citta, provincia, cap,
    creato_da
  ) values (
    p_crm_type, customer_record.ragione_sociale, 'attivo', current_profile_id,
    customer_record.codice_cliente, 'mexal', customer_record.partita_iva,
    customer_record.codice_fiscale, customer_record.email, customer_record.telefono,
    customer_record.indirizzo, customer_record.localita, customer_record.provincia,
    customer_record.cap, current_profile_id
  )
  on conflict (tipo, codice_cliente_mexal) where codice_cliente_mexal is not null
  do update set
    nome = excluded.nome,
    partita_iva = coalesce(excluded.partita_iva, crm_accounts.partita_iva),
    codice_fiscale = coalesce(excluded.codice_fiscale, crm_accounts.codice_fiscale),
    email = coalesce(excluded.email, crm_accounts.email),
    telefono = coalesce(excluded.telefono, crm_accounts.telefono),
    aggiornato_il = now()
  returning id into account_id;

  insert into public.crm_audit_log (utente_id, entita_tipo, entita_id, operazione, dettagli)
  values (current_profile_id, 'crm_account', account_id, 'ensure_canonical_extension',
    jsonb_build_object('customer_key', 'mexal:' || customer_record.codice_cliente, 'crm_type', p_crm_type));

  return account_id;
end;
$$;

revoke all on function public.crm_ensure_canonical_account(text,text) from public, anon;
grant execute on function public.crm_ensure_canonical_account(text,text) to authenticated, service_role;

-- Sorgente canonica e deduplicata per i KPI ordine. Un ordine vale una volta sola:
-- gli OCT importati sono testate con origine mexal_oct; OCM/OCI/OCX sincronizzati
-- sono documenti figli della medesima testata e non devono moltiplicarne l'importo.
create or replace view public.crm_order_kpi_source
with (security_invoker = true)
as
select
  order_header.*,
  coalesce(document_lineage.document_types, '{}'::text[]) as mexal_document_types,
  case
    when order_header.origine = 'mexal_oct' then 'mexal_oct'
    when cardinality(coalesce(document_lineage.document_types, '{}'::text[])) > 0 then 'mexal_documents'
    else 'workspace'
  end as crm_order_source
from public.ordini_testate order_header
left join lateral (
  select array_agg(distinct document.tipo_documento order by document.tipo_documento) as document_types
  from public.ordini_documenti_mexal document
  where document.ordine_id = order_header.id
    and document.tipo_documento in ('OCT', 'OCM', 'OCI', 'OCX')
    and coalesce(document.presente_in_mexal, true)
) document_lineage on true;

grant select on public.crm_order_kpi_source to authenticated, service_role;
comment on view public.crm_order_kpi_source is
  'Ordini CRM deduplicati: Workspace, OCT inbound e testate collegate a OCM/OCI/OCX Mexal.';

commit;

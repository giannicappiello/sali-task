begin;

-- Snapshot esplicito dei campi Mexal usati dalla nuova segmentazione CRM.
alter table if exists public.ordini_clienti_cache
  add column if not exists cod_alternativo text,
  add column if not exists nome_ricerca_cf text;

create index if not exists ordini_clienti_cache_cod_alternativo_idx
  on public.ordini_clienti_cache (upper(btrim(cod_alternativo)))
  where attivo_mexal is true;
create index if not exists ordini_clienti_cache_nome_ricerca_cf_idx
  on public.ordini_clienti_cache (upper(btrim(nome_ricerca_cf)))
  where attivo_mexal is true;

comment on column public.ordini_clienti_cache.cod_alternativo is
  'cod_alternativo letto dall anagrafica cliente Mexal.';
comment on column public.ordini_clienti_cache.nome_ricerca_cf is
  'nome_ricerca_cf letto dall anagrafica cliente Mexal.';

-- La richiesta funzionale sostituisce integralmente la classificazione per
-- agente: anche gli override precedenti vengono volutamente eliminati.
delete from public.crm_customer_classifications;

alter table public.crm_customer_classifications
  drop constraint if exists crm_customer_classifications_origine_classificazione_check;
alter table public.crm_customer_classifications
  alter column origine_classificazione set default 'mexal_fields';
alter table public.crm_customer_classifications
  add constraint crm_customer_classifications_origine_classificazione_check
  check (origine_classificazione = 'mexal_fields');

create or replace function public.crm_customer_area_from_mexal_fields(
  target_cod_alternativo text,
  target_nome_ricerca_cf text
)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when upper(btrim(coalesce(target_cod_alternativo, ''))) = 'PRIVATE'
      then 'conto_terzi'
    when upper(btrim(coalesce(target_cod_alternativo, ''))) = 'DIRECT'
     and upper(btrim(coalesce(target_nome_ricerca_cf, ''))) = 'BTOB'
      then 'b2b'
    when upper(btrim(coalesce(target_cod_alternativo, ''))) = 'DIRECT'
     and upper(btrim(coalesce(target_nome_ricerca_cf, ''))) = 'BTOC'
      then 'online'
    else null
  end;
$$;

create or replace function public.crm_refresh_customer_classification(target_customer_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_area text;
begin
  select case when customer.attivo_mexal is true then
    public.crm_customer_area_from_mexal_fields(customer.cod_alternativo, customer.nome_ricerca_cf)
  end
  into next_area
  from public.ordini_clienti_cache customer
  where customer.codice_cliente = target_customer_code;

  if not found or next_area is null then
    delete from public.crm_customer_classifications
    where codice_cliente = target_customer_code;
    return;
  end if;

  insert into public.crm_customer_classifications (
    codice_cliente, area_automatica, agente_classificazione,
    origine_classificazione, classificata_il, aggiornata_il
  ) values (
    target_customer_code, next_area, null,
    'mexal_fields', now(), now()
  )
  on conflict (codice_cliente) do update set
    area_automatica = excluded.area_automatica,
    agente_classificazione = null,
    origine_classificazione = 'mexal_fields',
    area_override = null,
    override_da = null,
    override_il = null,
    override_note = null,
    classificata_il = case
      when crm_customer_classifications.area_automatica is distinct from excluded.area_automatica
      then now() else crm_customer_classifications.classificata_il end,
    aggiornata_il = now();
end;
$$;

create or replace function public.crm_refresh_customer_classifications()
returns table(processed bigint, conto_terzi bigint, b2b bigint, online bigint, unclassified bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not public.workspace_user_is_admin() then
    raise exception 'Solo un Amministratore Workspace può popolare le classificazioni CRM.' using errcode = '42501';
  end if;

  -- Ricostruzione completa e deterministica: nessuna classificazione o
  -- override del vecchio metodo sopravvive al refresh.
  delete from public.crm_customer_classifications;

  insert into public.crm_customer_classifications (
    codice_cliente, area_automatica, agente_classificazione,
    origine_classificazione, classificata_il, aggiornata_il
  )
  select
    customer.codice_cliente,
    public.crm_customer_area_from_mexal_fields(customer.cod_alternativo, customer.nome_ricerca_cf),
    null,
    'mexal_fields', now(), now()
  from public.ordini_clienti_cache customer
  where customer.attivo_mexal is true
    and public.crm_customer_area_from_mexal_fields(customer.cod_alternativo, customer.nome_ricerca_cf) is not null;

  return query
  with active_customers as (
    select count(*)::bigint as total
    from public.ordini_clienti_cache
    where attivo_mexal is true
  ), classified as (
    select
      count(*)::bigint as total,
      count(*) filter (where area_crm = 'conto_terzi')::bigint as private_total,
      count(*) filter (where area_crm = 'b2b')::bigint as btob_total,
      count(*) filter (where area_crm = 'online')::bigint as btoc_total
    from public.crm_customer_classifications
  )
  select active.total, classified.private_total, classified.btob_total,
         classified.btoc_total, greatest(active.total - classified.total, 0)::bigint
  from active_customers active cross join classified;
end;
$$;

drop trigger if exists crm_classify_customer_after_mexal_sync on public.ordini_clienti_cache;
create trigger crm_classify_customer_after_mexal_sync
after insert or update of cod_alternativo, nome_ricerca_cf, attivo_mexal
on public.ordini_clienti_cache
for each row execute function public.crm_classify_customer_after_mexal_sync();

-- Nuovo contenitore DIRECT; PRIVATE usa l area canonica conto_terzi per non
-- spezzare URL, opportunita e storico operativo gia esistenti.
insert into public.workspace_moduli
  (codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,
   assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,icona,dipendenze_alternative)
values
  ('crm_direct','CRM DIRECT','Clienti DIRECT suddivisi nei rami BtoB e BtoC.','contenitore','crm','/crm/direct','workspace',false,false,false,false,true,67,'workflow',array['crm_b2b','crm_online'])
on conflict (codice) do update set
  nome=excluded.nome, descrizione=excluded.descrizione, tipo=excluded.tipo,
  area=excluded.area, percorso=excluded.percorso, provider=excluded.provider,
  sempre_disponibile=excluded.sempre_disponibile,
  assegnabile_reparto=excluded.assegnabile_reparto,
  configurabile_ruolo=excluded.configurabile_ruolo,
  mostra_menu=excluded.mostra_menu, attivo=true, ordine=excluded.ordine,
  icona=excluded.icona, dipendenze_alternative=excluded.dipendenze_alternative,
  aggiornato_il=now();

update public.workspace_moduli
set nome='CRM PRIVATE',
    descrizione='Clienti con cod_alternativo PRIVATE.',
    ordine=66,
    aggiornato_il=now()
where codice='crm_conto_terzi';

update public.workspace_moduli
set dipendenze_alternative=array['crm_conto_terzi','crm_direct','crm_ai'],
    aggiornato_il=now()
where codice='crm';

insert into public.ruoli_moduli (ruolo_id,modulo,livello_accesso)
select distinct child.ruolo_id, 'crm_direct',
  case when role.amministratore_workspace then 'amministrazione' else 'lettura' end
from public.ruoli_moduli child
join public.ruoli role on role.id=child.ruolo_id
where child.modulo in ('crm_b2b','crm_online')
on conflict (ruolo_id,modulo) do update set
  livello_accesso=excluded.livello_accesso,
  aggiornato_il=now();

insert into public.workspace_schermate
  (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,icona,metadati,ultima_sincronizzazione)
values
  ('crm.direct.dashboard','CRM DIRECT','Accesso ai clienti DIRECT BtoB e BtoC.','workspace','/crm/direct','crm.direct.overview',false,true,25,'crm','workflow','{}',now())
on conflict (codice) do update set
  nome=excluded.nome, descrizione=excluded.descrizione, provider=excluded.provider,
  percorso=excluded.percorso, chiave_componente=excluded.chiave_componente,
  attiva=true, ordine=excluded.ordine, area=excluded.area, icona=excluded.icona,
  ultima_sincronizzazione=now();

insert into public.workspace_moduli_schermate
  (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values ('crm_direct','crm.direct.dashboard',10,true,true)
on conflict (modulo_codice,schermata_codice) do update set
  ordine=excluded.ordine, predefinita=true, visibile_menu=true;

create or replace view public.crm_customer_classification_catalog
with (security_invoker = false, security_barrier = true)
as
select
  customer.codice_cliente,
  customer.ragione_sociale,
  customer.codice_agente_mexal,
  classification.agente_classificazione,
  classification.area_automatica,
  classification.area_override,
  classification.area_crm,
  classification.origine_classificazione,
  case when classification.area_override is null then 'automatico' else 'manuale' end as modalita,
  classification.classificata_il,
  classification.override_il,
  classification.override_note,
  customer.attivo_mexal,
  coalesce(status.crm_active, true) as crm_active,
  status.changed_at as crm_status_changed_at,
  status.changed_by as crm_status_changed_by,
  status.reason as crm_status_reason,
  customer.cod_alternativo,
  customer.nome_ricerca_cf
from public.ordini_clienti_cache customer
join public.crm_customer_classifications classification
  on classification.codice_cliente = customer.codice_cliente
left join public.crm_customer_status status
  on status.customer_key = 'mexal:' || customer.codice_cliente
where customer.attivo_mexal is true
and classification.area_crm::text = any (
  ((select public.crm_visible_customer_areas()))::text[]
)
and classification.codice_cliente::text = any (
  (select coalesce(array_agg(visible.customer_code), '{}'::text[])
   from public.crm_visible_canonical_customer_codes() visible(customer_code))::text[]
);

revoke all on public.crm_customer_classification_catalog from public, anon;
grant select on public.crm_customer_classification_catalog to authenticated, service_role;

select public.crm_refresh_customer_classifications();

commit;

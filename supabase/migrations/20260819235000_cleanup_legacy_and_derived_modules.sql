begin;

-- Preserve department grants on the canonical business modules.
with module_map(old_code, canonical_code) as (
  values
    ('agenda', 'attivita'),
    ('progetti', 'attivita'),
    ('report', 'attivita'),
    ('analisi_attivita', 'attivita'),
    ('analisi_fatture', 'ordini_pr'),
    ('analisi_ordini_ph', 'ordini_ph'),
    ('analisi_beauty_days', 'beauty_days')
)
insert into public.reparti_moduli (reparto_id, modulo)
select distinct grants.reparto_id, module_map.canonical_code
from public.reparti_moduli grants
join module_map on module_map.old_code = grants.modulo
on conflict (reparto_id, modulo) do nothing;

-- Preserve the strongest role access level assigned through an obsolete alias.
with module_map(old_code, canonical_code) as (
  values
    ('agenda', 'attivita'),
    ('progetti', 'attivita'),
    ('report', 'attivita'),
    ('analisi_attivita', 'attivita'),
    ('analisi_fatture', 'ordini_pr'),
    ('analisi_ordini_ph', 'ordini_ph'),
    ('analisi_beauty_days', 'beauty_days')
), strongest as (
  select
    grants.ruolo_id,
    module_map.canonical_code as modulo,
    max(case grants.livello_accesso
      when 'amministrazione' then 3
      when 'scrittura' then 2
      else 1
    end) as access_rank
  from public.ruoli_moduli grants
  join module_map on module_map.old_code = grants.modulo
  group by grants.ruolo_id, module_map.canonical_code
)
insert into public.ruoli_moduli (ruolo_id, modulo, livello_accesso, aggiornato_il)
select
  ruolo_id,
  modulo,
  case access_rank when 3 then 'amministrazione' when 2 then 'scrittura' else 'lettura' end,
  now()
from strongest
on conflict (ruolo_id, modulo) do update set
  livello_accesso = case greatest(
    case public.ruoli_moduli.livello_accesso when 'amministrazione' then 3 when 'scrittura' then 2 else 1 end,
    case excluded.livello_accesso when 'amministrazione' then 3 when 'scrittura' then 2 else 1 end
  ) when 3 then 'amministrazione' when 2 then 'scrittura' else 'lettura' end,
  aggiornato_il = now();

-- Preserve any screen links an administrator may have added to the obsolete rows.
with module_map(old_code, canonical_code) as (
  values
    ('agenda', 'attivita'),
    ('progetti', 'attivita'),
    ('report', 'analisi_dati'),
    ('analisi_attivita', 'analisi_dati'),
    ('analisi_fatture', 'analisi_dati'),
    ('analisi_ordini_ph', 'analisi_dati'),
    ('analisi_beauty_days', 'analisi_dati')
)
insert into public.workspace_moduli_schermate
  (modulo_codice, schermata_codice, ordine, predefinita, visibile_menu)
select
  module_map.canonical_code,
  links.schermata_codice,
  links.ordine,
  false,
  links.visibile_menu
from public.workspace_moduli_schermate links
join module_map on module_map.old_code = links.modulo_codice
on conflict (modulo_codice, schermata_codice) do nothing;

-- Preserve uncommon AI policies conservatively when the canonical policy is absent.
with module_map(old_code, canonical_code) as (
  values
    ('agenda', 'attivita'),
    ('progetti', 'attivita'),
    ('report', 'attivita'),
    ('analisi_attivita', 'attivita'),
    ('analisi_fatture', 'ordini_pr'),
    ('analisi_ordini_ph', 'ordini_ph'),
    ('analisi_beauty_days', 'beauty_days')
), strongest as (
  select distinct on (policies.reparto_id, module_map.canonical_code)
    policies.reparto_id,
    module_map.canonical_code as modulo_codice,
    policies.livello,
    policies.riconoscimento_immagini,
    policies.aggiornato_da,
    policies.aggiornato_il
  from public.ai_reparti_moduli policies
  join module_map on module_map.old_code = policies.modulo_codice
  order by policies.reparto_id, module_map.canonical_code,
    case policies.livello when 'conferma' then 4 when 'bozza' then 3 when 'analisi' then 2 else 1 end desc,
    policies.aggiornato_il desc
)
insert into public.ai_reparti_moduli
  (reparto_id, modulo_codice, livello, riconoscimento_immagini, aggiornato_da, aggiornato_il)
select reparto_id, modulo_codice, livello, riconoscimento_immagini, aggiornato_da, aggiornato_il
from strongest
on conflict (reparto_id, modulo_codice) do nothing;

with module_map(old_code, canonical_code) as (
  values
    ('agenda', 'attivita'),
    ('progetti', 'attivita'),
    ('report', 'attivita'),
    ('analisi_attivita', 'attivita'),
    ('analisi_fatture', 'ordini_pr'),
    ('analisi_ordini_ph', 'ordini_ph'),
    ('analisi_beauty_days', 'beauty_days')
), strongest as (
  select distinct on (policies.utente_id, module_map.canonical_code)
    policies.utente_id,
    module_map.canonical_code as modulo_codice,
    policies.livello,
    policies.riconoscimento_immagini,
    policies.aggiornato_da,
    policies.aggiornato_il
  from public.ai_utenti_moduli policies
  join module_map on module_map.old_code = policies.modulo_codice
  order by policies.utente_id, module_map.canonical_code,
    case policies.livello when 'conferma' then 5 when 'bozza' then 4 when 'analisi' then 3 when 'nessuno' then 2 else 1 end desc,
    policies.aggiornato_il desc
)
insert into public.ai_utenti_moduli
  (utente_id, modulo_codice, livello, riconoscimento_immagini, aggiornato_da, aggiornato_il)
select utente_id, modulo_codice, livello, riconoscimento_immagini, aggiornato_da, aggiornato_il
from strongest
on conflict (utente_id, modulo_codice) do nothing;

-- Analysis dependencies belong to screens, not to separate module records.
with screen_sources(screen_code, source_module) as (
  values
    ('analisi.attivita', 'attivita'),
    ('analisi.fatture', 'ordini_pr'),
    ('analisi.ordini_ph', 'ordini_ph'),
    ('analisi.beauty_days', 'beauty_days')
)
update public.workspace_schermate screens
set
  metadati = coalesce(screens.metadati, '{}'::jsonb)
    || jsonb_build_object('source_module', screen_sources.source_module),
  ultima_sincronizzazione = now()
from screen_sources
where screens.codice = screen_sources.screen_code;

delete from public.workspace_moduli
where codice in (
  'agenda',
  'progetti',
  'report',
  'analisi_attivita',
  'analisi_fatture',
  'analisi_ordini_ph',
  'analisi_beauty_days'
);

commit;

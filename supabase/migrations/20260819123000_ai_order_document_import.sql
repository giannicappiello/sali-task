begin;

alter table public.ai_generazioni drop constraint if exists ai_generazioni_tipo_check;
alter table public.ai_generazioni add constraint ai_generazioni_tipo_check
  check (tipo in ('chat_interna','ricerca_web','analisi_ordini','piano_produzione','piano_ordini','piano_attivita','riconoscimento_ordine'));

create table if not exists public.ai_ordini_acquisizioni (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references public.utenti(id) on delete cascade,
  generazione_id uuid references public.ai_generazioni(id) on delete set null,
  modulo_codice text not null check (modulo_codice in ('ordini_pr','ordini_ph')),
  nome_file text not null,
  tipo_file text not null,
  dimensione_byte bigint not null default 0,
  stato text not null default 'in_corso' check (stato in ('in_corso','completata','errore')),
  esito jsonb,
  errore text,
  creata_il timestamptz not null default now(),
  completata_il timestamptz
);

create index if not exists ai_ordini_acquisizioni_utente_data_idx
  on public.ai_ordini_acquisizioni (utente_id, creata_il desc);

alter table public.ai_ordini_acquisizioni enable row level security;
drop policy if exists "users read own AI order acquisitions" on public.ai_ordini_acquisizioni;
create policy "users read own AI order acquisitions"
on public.ai_ordini_acquisizioni for select to authenticated
using (utente_id=public.workspace_current_profile_id() or public.workspace_user_is_admin());
grant select on public.ai_ordini_acquisizioni to authenticated;

create or replace function public.workspace_ai_module_access(target_module_code text)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with me as (
    select u.id,u.reparto_id,u.ruolo_id,coalesce(r.amministratore_workspace,false) as is_admin
    from public.utenti u left join public.ruoli r on r.id=u.ruolo_id
    where u.auth_user_id=auth.uid() and u.attivo is not false limit 1
  ), departments as (
    select ur.reparto_id from me join public.utenti_reparti ur on ur.utente_id=me.id
    union select reparto_id from me where reparto_id is not null
  ), policy as (
    select
      max(case coalesce(p.livello,'nessuno') when 'conferma' then 3 when 'bozza' then 2 when 'analisi' then 1 else 0 end) as level_rank,
      coalesce(bool_or(p.riconoscimento_immagini),false) as vision
    from departments d left join public.ai_reparti_moduli p
      on p.reparto_id=d.reparto_id and p.modulo_codice=target_module_code
  ), general as (
    select coalesce(bool_or(c.riconoscimento_immagini),false) as vision
    from departments d left join public.ai_reparti_capacita c on c.reparto_id=d.reparto_id
  ), effective as (
    select me.*,
      coalesce(o.livello,'eredita') as override_level,
      o.riconoscimento_immagini as override_vision,
      coalesce(rm.livello_accesso,'lettura') as business_level,
      policy.level_rank,policy.vision as module_vision,general.vision as general_vision
    from me cross join policy cross join general
    left join public.ai_utenti_moduli o on o.utente_id=me.id and o.modulo_codice=target_module_code
    left join public.ruoli_moduli rm on rm.ruolo_id=me.ruolo_id and rm.modulo=target_module_code
  ), resolved as (
    select *,case
      when is_admin then 'conferma'
      when not public.workspace_module_enabled_for_user(id,target_module_code) then 'nessuno'
      when override_level<>'eredita' then override_level
      when level_rank=3 then 'conferma'
      when level_rank=2 then 'bozza'
      when level_rank=1 then 'analisi'
      else 'nessuno' end as ai_level
    from effective
  )
  select coalesce((select jsonb_build_object(
    'allowed',is_admin or (
      public.workspace_module_enabled_for_user(id,'assistente_ai')
      and public.workspace_module_enabled_for_user(id,target_module_code)
      and business_level in ('scrittura','amministrazione')
      and ai_level in ('bozza','conferma')
      and general_vision
      and coalesce(override_vision,module_vision,false)
    ),
    'level',ai_level,
    'vision',case when is_admin then true else general_vision and coalesce(override_vision,module_vision,false) end,
    'business_level',business_level
  ) from resolved),jsonb_build_object('allowed',false,'level','nessuno','vision',false,'business_level','nessuno'));
$$;

revoke all on function public.workspace_ai_module_access(text) from public,anon;
grant execute on function public.workspace_ai_module_access(text) to authenticated,service_role;

commit;

begin;

-- ============================================================
-- ORDER MODULES CONFIGURATION
-- Compatibilità con tabella già esistente
-- ============================================================


-- ============================================================
-- INDICE
-- Creato solo se le colonne esistono
-- ============================================================

do $$
begin

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ordini_moduli_configurazione'
      and column_name = 'modulo'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ordini_moduli_configurazione'
      and column_name = 'anno'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ordini_moduli_configurazione'
      and column_name = 'mese'
  )
  then

    execute '
      create index if not exists ordini_testate_modulo_mese_idx
      on public.ordini_moduli_configurazione
      (
        modulo,
        anno,
        mese
      )
    ';

  end if;

end $$;



-- ============================================================
-- UPDATED AT
-- ============================================================

create or replace function public.set_ordini_moduli_configurazione_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


drop trigger if exists ordini_moduli_configurazione_updated_at
on public.ordini_moduli_configurazione;


create trigger ordini_moduli_configurazione_updated_at
before update on public.ordini_moduli_configurazione
for each row
execute function public.set_ordini_moduli_configurazione_updated_at();



-- ============================================================
-- RLS
-- ============================================================

alter table public.ordini_moduli_configurazione
enable row level security;



-- ============================================================
-- LETTURA UTENTI AUTENTICATI
-- ============================================================

drop policy if exists "authenticated read order module config"
on public.ordini_moduli_configurazione;


create policy "authenticated read order module config"
on public.ordini_moduli_configurazione
for select
to authenticated
using (true);



-- ============================================================
-- GESTIONE ADMIN
-- ============================================================

drop policy if exists "admins manage order module config"
on public.ordini_moduli_configurazione;


create policy "admins manage order module config"
on public.ordini_moduli_configurazione
for all
to authenticated
using
(
  exists
  (
    select 1
    from public.utenti u
    left join public.ruoli r
      on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
      and
      (
        coalesce(r.livello,0) >= 80
        or lower(coalesce(r.nome,'')) in
        (
          'admin',
          'administrator',
          'amministratore',
          'super admin',
          'direzione'
        )
      )
  )
)
with check
(
  exists
  (
    select 1
    from public.utenti u
    left join public.ruoli r
      on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
      and
      (
        coalesce(r.livello,0) >= 80
        or lower(coalesce(r.nome,'')) in
        (
          'admin',
          'administrator',
          'amministratore',
          'super admin',
          'direzione'
        )
      )
  )
);


commit;
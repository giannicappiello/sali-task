alter table if exists public.mexal_regole_provvigioni
  add column if not exists tipo_provvigione_mexal text,
  add column if not exists formula_mexal text,
  add column if not exists codice_condizione_agente_mexal integer not null default 0,
  add column if not exists sincronizzato_il timestamptz;

-- Estende il vincolo esistente prima di inserire la nuova pianificazione.
-- Il nome del constraint è quello già presente nello schema Workspace.
alter table if exists public.mexal_sync_schedules
  drop constraint if exists mexal_sync_schedules_sync_type_check;

alter table if exists public.mexal_sync_schedules
  add constraint mexal_sync_schedules_sync_type_check
  check (sync_type in (
    'clients',
    'products',
    'commercial_conditions',
    'document_series',
    'stocks',
    'list_price_commissions',
    'orders'
  ));

-- Elimina la regola di bootstrap verificata manualmente quando la stessa coppia
-- è già rappresentata dalla sorgente ufficiale Mexal.
delete from public.mexal_regole_provvigioni manuale
where manuale.origine = 'documento_mexal_verificato'
  and exists (
    select 1
    from public.mexal_regole_provvigioni mexal
    where mexal.origine = 'mexal_provvigioni_listini'
      and mexal.categoria_cliente = manuale.categoria_cliente
      and mexal.categoria_prodotto = manuale.categoria_prodotto
      and coalesce(mexal.codice_agente_mexal, '') = coalesce(manuale.codice_agente_mexal, '')
  );

-- Rende configurabile la nuova sincronizzazione nello stesso dispatcher delle altre.
insert into public.mexal_sync_schedules (
  sync_type, enabled, schedule_mode, batch_size, execution_order, created_at, updated_at
)
select 'list_price_commissions', false, 'daily_vercel_hobby', 500, 6, now(), now()
where not exists (
  select 1 from public.mexal_sync_schedules where sync_type = 'list_price_commissions'
);

create index if not exists mexal_regole_provvigioni_origine_idx
  on public.mexal_regole_provvigioni (origine, categoria_cliente, categoria_prodotto);

comment on column public.mexal_regole_provvigioni.tipo_provvigione_mexal is 'Tipo provvigione restituito da Mexal, ad esempio %. ';
comment on column public.mexal_regole_provvigioni.formula_mexal is 'Formula originale Mexal senza reinterpretazioni.';
comment on column public.mexal_regole_provvigioni.sincronizzato_il is 'Ultimo allineamento della regola con Mexal.';

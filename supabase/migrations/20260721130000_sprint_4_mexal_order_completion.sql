-- Sprint 4: immutable, human-visible Workspace order number.  The UUID stays
-- the technical primary key; the sequence is allocated under a row lock.
alter table if exists public.ordini_testate
  add column if not exists numero_progressivo bigint,
  add column if not exists anno_progressivo integer,
  add column if not exists numero_ordine_visualizzato text,
  add column if not exists codice_pagamento_mexal text,
  add column if not exists descrizione_pagamento_mexal text,
  add column if not exists trasporto_mexal jsonb not null default '{}'::jsonb;

alter table if exists public.ordini_righe
  add column if not exists stato_riga_mexal text,
  add column if not exists provvigione_percentuale numeric;

alter table if exists public.ordini_configurazione_documenti
  add column if not exists id_causale_vendita_diretta text;

create table if not exists public.ordini_progressivi_annuali (
  anno integer primary key,
  ultimo_numero bigint not null default 0 check (ultimo_numero >= 0)
);

create or replace function public.assegna_numero_ordine_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_anno integer; v_numero bigint;
begin
  if new.numero_progressivo is not null and new.anno_progressivo is not null then
    new.numero_ordine_visualizzato := coalesce(nullif(new.numero_ordine_visualizzato, ''), new.numero_progressivo::text || '/' || new.anno_progressivo::text);
    return new;
  end if;
  v_anno := extract(year from coalesce(new.data_ordine, current_date))::integer;
  insert into public.ordini_progressivi_annuali(anno, ultimo_numero) values (v_anno, 1)
  on conflict (anno) do update set ultimo_numero = public.ordini_progressivi_annuali.ultimo_numero + 1
  returning ultimo_numero into v_numero;
  new.anno_progressivo := v_anno;
  new.numero_progressivo := v_numero;
  new.numero_ordine_visualizzato := v_numero::text || '/' || v_anno::text;
  return new;
end $$;

drop trigger if exists assegna_numero_ordine_workspace on public.ordini_testate;
create trigger assegna_numero_ordine_workspace
before insert on public.ordini_testate
for each row execute function public.assegna_numero_ordine_workspace();

-- Backfill deterministic existing orders without changing their UUIDs.
with ordinati as (
  select id, extract(year from coalesce(data_ordine, created_at::date))::integer as anno,
         row_number() over (partition by extract(year from coalesce(data_ordine, created_at::date)) order by created_at nulls last, id) as numero
  from public.ordini_testate where numero_progressivo is null or anno_progressivo is null
)
update public.ordini_testate t set anno_progressivo = o.anno, numero_progressivo = o.numero,
  numero_ordine_visualizzato = o.numero::text || '/' || o.anno::text
from ordinati o where o.id = t.id;

insert into public.ordini_progressivi_annuali(anno, ultimo_numero)
select anno_progressivo, max(numero_progressivo) from public.ordini_testate
where anno_progressivo is not null and numero_progressivo is not null
group by anno_progressivo
on conflict (anno) do update set ultimo_numero = greatest(public.ordini_progressivi_annuali.ultimo_numero, excluded.ultimo_numero);

create unique index if not exists ordini_testate_anno_numero_workspace_uniq
  on public.ordini_testate(anno_progressivo, numero_progressivo)
  where anno_progressivo is not null and numero_progressivo is not null;

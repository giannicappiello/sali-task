-- Allinea lo stato dell'ordine padre e rende leggibili i documenti figli OCM/OCX/OCI.
-- Migrazione idempotente: non elimina ordini né documenti.

grant select on public.ordini_documenti_mexal to authenticated;
grant select on public.ordini_documenti_mexal_righe to authenticated;

alter table public.ordini_documenti_mexal enable row level security;
alter table public.ordini_documenti_mexal_righe enable row level security;

drop policy if exists "authenticated read mexal order documents"
on public.ordini_documenti_mexal;

create policy "authenticated read mexal order documents"
on public.ordini_documenti_mexal
for select
to authenticated
using (true);

drop policy if exists "authenticated read mexal order document lines"
on public.ordini_documenti_mexal_righe;

create policy "authenticated read mexal order document lines"
on public.ordini_documenti_mexal_righe
for select
to authenticated
using (true);

-- Ricostruisce le righe figlie per i documenti già creati prima di questa versione.
-- Gli articoli IMP appartengono esclusivamente a OCI; gli altri articoli vengono
-- ripartiti fra OCM e OCX usando le rispettive quantità confermate.
with righe_classificate as (
  select
    d.id as documento_mexal_id,
    r.id as ordine_riga_id,
    row_number() over (
      partition by d.id
      order by r.id
    )::integer as posizione,
    r.codice_articolo,
    r.descrizione,
    case d.tipo_documento
      when 'OCM' then coalesce(r.quantita_ocm, 0)
      when 'OCX' then coalesce(r.quantita_ocx, 0)
      when 'OCI' then coalesce(r.quantita, 0)
    end as quantita,
    coalesce(r.prezzo_netto, r.prezzo_listino) as prezzo,
    coalesce(nullif(btrim(r.sconto_commerciale::text), ''), r.sconto_percentuale::text) as sconto,
    jsonb_build_object(
      'aliquota_iva', r.aliquota_iva,
      'provvigione_percentuale', r.provvigione_percentuale
    ) as dati_mexal
  from public.ordini_documenti_mexal d
  join public.ordini_righe r
    on r.ordine_id = d.ordine_id
  where d.id is not null
    and (
      (
        d.tipo_documento = 'OCM'
        and upper(coalesce(r.codice_articolo, '')) not like 'IMP%'
        and coalesce(r.quantita_ocm, 0) > 0
      )
      or (
        d.tipo_documento = 'OCX'
        and upper(coalesce(r.codice_articolo, '')) not like 'IMP%'
        and coalesce(r.quantita_ocx, 0) > 0
      )
      or (
        d.tipo_documento = 'OCI'
        and upper(coalesce(r.codice_articolo, '')) like 'IMP%'
        and coalesce(r.quantita, 0) > 0
      )
    )
)
insert into public.ordini_documenti_mexal_righe (
  documento_mexal_id,
  ordine_riga_id,
  posizione,
  codice_articolo,
  descrizione,
  quantita,
  prezzo,
  sconto,
  dati_mexal,
  aggiornato_il
)
select
  documento_mexal_id,
  ordine_riga_id,
  posizione,
  codice_articolo,
  descrizione,
  quantita,
  prezzo,
  sconto,
  dati_mexal,
  now()
from righe_classificate
on conflict (documento_mexal_id, posizione)
do update set
  ordine_riga_id = excluded.ordine_riga_id,
  codice_articolo = excluded.codice_articolo,
  descrizione = excluded.descrizione,
  quantita = excluded.quantita,
  prezzo = excluded.prezzo,
  sconto = excluded.sconto,
  dati_mexal = excluded.dati_mexal,
  aggiornato_il = now();

-- Recupera gli ordini per i quali tutti i documenti Mexal già risultano evasi.
update public.ordini_testate t
set stato = 'evaso'
where exists (
  select 1
  from public.ordini_documenti_mexal d
  where d.ordine_id = t.id
    and nullif(btrim(d.numero), '') is not null
)
and not exists (
  select 1
  from public.ordini_documenti_mexal d
  where d.ordine_id = t.id
    and nullif(btrim(d.numero), '') is not null
    and d.stato_operativo <> 'EVASO'
);

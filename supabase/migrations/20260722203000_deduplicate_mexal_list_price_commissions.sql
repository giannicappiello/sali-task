-- Rimuove i duplicati creati dalle sincronizzazioni precedenti delle provvigioni listini.
-- Mantiene la riga Mexal più recente per ogni combinazione cliente/articolo/agente.

with ranked as (
  select
    id,
    row_number() over (
      partition by
        categoria_cliente,
        categoria_prodotto,
        coalesce(codice_agente_mexal, '')
      order by
        sincronizzato_il desc nulls last,
        aggiornato_il desc nulls last,
        id desc
    ) as posizione
  from public.mexal_regole_provvigioni
  where origine = 'mexal_provvigioni_listini'
)
delete from public.mexal_regole_provvigioni regola
using ranked
where regola.id = ranked.id
  and ranked.posizione > 1;

-- Impedisce nuovi duplicati soltanto per le regole provenienti dall'endpoint
-- Mexal provvigioni-listini. Le regole manuali o di altra origine non sono coinvolte.
create unique index if not exists mexal_regole_provvigioni_listini_unique_idx
  on public.mexal_regole_provvigioni (
    categoria_cliente,
    categoria_prodotto,
    coalesce(codice_agente_mexal, '')
  )
  where origine = 'mexal_provvigioni_listini';

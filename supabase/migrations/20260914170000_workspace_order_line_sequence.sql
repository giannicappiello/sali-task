-- Preserve the exact Workspace line sequence when an order is saved, edited
-- and subsequently split into Mexal documents. Existing Mexal imports already
-- provide mexal_posizione explicitly and are left unchanged.
create or replace function public.assegna_posizione_riga_ordine()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.mexal_posizione is null then
    select coalesce(max(r.mexal_posizione), 0) + 1
      into new.mexal_posizione
    from public.ordini_righe r
    where r.ordine_id = new.ordine_id;
  end if;
  return new;
end;
$$;

drop trigger if exists assegna_posizione_riga_ordine_trigger on public.ordini_righe;
create trigger assegna_posizione_riga_ordine_trigger
before insert on public.ordini_righe
for each row execute function public.assegna_posizione_riga_ordine();

-- Give historical rows a stable fallback sequence without changing rows that
-- already carry the source/Workspace position.
with missing as (
  select r.id,
         row_number() over (partition by r.ordine_id order by r.id)
         + coalesce((select max(existing.mexal_posizione)
                     from public.ordini_righe existing
                     where existing.ordine_id = r.ordine_id), 0) as position
  from public.ordini_righe r
  where r.mexal_posizione is null
)
update public.ordini_righe r
set mexal_posizione = missing.position
from missing
where r.id = missing.id;

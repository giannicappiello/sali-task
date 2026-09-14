begin;

alter table if exists public.ordini_righe
  add column if not exists ean text;

comment on column public.ordini_righe.ean is
  'Snapshot del barcode EAN dell''articolo usato nei PDF degli ordini PH.';

update public.ordini_righe as line
set ean = nullif(btrim(product.ean), '')
from public.ordini_prodotti_cache as product
where nullif(btrim(line.ean), '') is null
  and upper(btrim(product.codice_articolo)) = upper(btrim(line.codice_articolo))
  and nullif(btrim(product.ean), '') is not null;

create or replace function public.snapshot_order_line_ean()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(new.ean), '') is null then
    select nullif(btrim(product.ean), '')
      into new.ean
    from public.ordini_prodotti_cache as product
    where upper(btrim(product.codice_articolo)) = upper(btrim(new.codice_articolo))
      and nullif(btrim(product.ean), '') is not null
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists ordini_righe_snapshot_ean on public.ordini_righe;
create trigger ordini_righe_snapshot_ean
before insert or update of codice_articolo, ean on public.ordini_righe
for each row execute function public.snapshot_order_line_ean();

revoke all on function public.snapshot_order_line_ean() from public, anon, authenticated;
grant execute on function public.snapshot_order_line_ean() to service_role;

commit;

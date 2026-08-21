alter table public.documenti_workspace
  add column if not exists prodotto_id uuid references public.prodotti(id) on delete set null;
create index if not exists documenti_workspace_prodotto_idx on public.documenti_workspace(prodotto_id, attivo);

update public.documenti_workspace d
set prodotto_id = p.id,
    prodotto = coalesce(d.prodotto, p.nome)
from public.prodotti p
where d.prodotto_id is null
  and upper(coalesce(p.codice_mexal, p.codice, '')) like 'IT%'
  and regexp_replace(upper(d.nome_file), '[^A-Z0-9]', '', 'g') like '%' || regexp_replace(upper(coalesce(p.codice_mexal, p.codice, '')), '[^A-Z0-9]', '', 'g') || '%';

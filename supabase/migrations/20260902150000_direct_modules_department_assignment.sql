begin;

-- I moduli DIRECT sono disponibili agli amministratori e ai soli reparti
-- esplicitamente autorizzati tramite reparti_moduli.
create or replace function public.protect_workspace_catalog_records()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and old.protetto then
    raise exception 'Il modulo % è protetto e non può essere eliminato.', old.codice;
  end if;
  if tg_op = 'UPDATE' and old.protetto and (
    new.attivo is false
    or (
      new.sempre_disponibile is false
      and old.codice not in ('documenti', 'prodotti')
    )
  ) then
    raise exception 'Il modulo % deve restare attivo e disponibile.', old.codice;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

update public.workspace_moduli
set nome = case codice
      when 'documenti' then 'Documenti Direct'
      when 'prodotti' then 'Prodotti Direct'
    end,
    descrizione = case codice
      when 'documenti' then 'Archivio documentale Direct assegnabile ai reparti autorizzati.'
      when 'prodotti' then 'Catalogo prodotti Direct assegnabile ai reparti autorizzati.'
    end,
    sempre_disponibile = false,
    assegnabile_reparto = true,
    configurabile_ruolo = true,
    aggiornato_il = now()
where codice in ('documenti', 'prodotti');

update public.workspace_schermate
set nome = 'Prodotti Direct',
    descrizione = 'Catalogo prodotti Direct riservato ai reparti autorizzati.'
where codice = 'prodotti' or percorso = '/products';

commit;

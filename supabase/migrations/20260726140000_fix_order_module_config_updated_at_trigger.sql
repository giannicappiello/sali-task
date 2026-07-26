begin;

create or replace function public.set_ordini_moduli_configurazione_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.aggiornato_il = now();
  return new;
end;
$$;

commit;

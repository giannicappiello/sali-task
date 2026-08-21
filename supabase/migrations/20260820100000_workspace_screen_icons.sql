begin;

alter table public.workspace_schermate
  add column if not exists icona text not null default 'blocks';

-- Alla prima attivazione ogni schermata eredita l'icona del primo modulo
-- collegato; l'amministratore potra poi personalizzarla liberamente.
update public.workspace_schermate schermata
set icona=coalesce((
  select modulo.icona
  from public.workspace_moduli_schermate collegamento
  join public.workspace_moduli modulo on modulo.codice=collegamento.modulo_codice
  where collegamento.schermata_codice=schermata.codice
  order by collegamento.predefinita desc,collegamento.ordine,modulo.ordine
  limit 1
),'blocks')
where nullif(btrim(schermata.icona),'') is null or schermata.icona='blocks';

create or replace function public.admin_update_workspace_screen(target_screen jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
  target_area text := lower(btrim(coalesce(target_screen->>'area','workspace')));
begin
  if not public.workspace_user_is_admin() then raise exception 'Operazione riservata all''amministratore Workspace.'; end if;
  if not exists(select 1 from public.workspace_aree where codice=target_area) then raise exception 'Area non valida.'; end if;
  update public.workspace_schermate set
    nome=btrim(target_screen->>'nome'),
    descrizione=nullif(btrim(target_screen->>'descrizione'),''),
    area=target_area,
    icona=coalesce(nullif(btrim(target_screen->>'icona'),''),'blocks'),
    attiva=case when protetta then true else coalesce((target_screen->>'attiva')::boolean,true) end,
    ordine=coalesce((target_screen->>'ordine')::integer,ordine)
  where codice=target_screen->>'codice';
end $$;

commit;

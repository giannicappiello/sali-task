begin;

drop function if exists public.consume_progremes_sso_ticket(text);
create function public.consume_progremes_sso_ticket(target_token_hash text)
returns table (
  workspace_user_id uuid,
  email text,
  nome text,
  cognome text,
  amministratore boolean,
  moduli text[]
)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with consumed as (
    update public.progremes_sso_tickets ticket set consumato_il=now()
    where ticket.token_hash=target_token_hash and ticket.consumato_il is null and ticket.scade_il>=now()
    returning ticket.utente_id
  ), profile as (
    select u.*, coalesce(r.amministratore_workspace,false) is_admin
    from consumed c join public.utenti u on u.id=c.utente_id
    left join public.ruoli r on r.id=u.ruolo_id
    where u.attivo is not false
  ), departments as (
    select ur.reparto_id from profile p join public.utenti_reparti ur on ur.utente_id=p.id
    union select p.reparto_id from profile p where p.reparto_id is not null
  )
  select p.id, lower(btrim(p.email)), coalesce(p.nome,''), coalesce(p.cognome,''), p.is_admin,
    case when p.is_admin then coalesce((select array_agg(m.codice order by m.ordine,m.nome) from public.progremes_moduli m where m.attivo), array[]::text[])
    else coalesce((select array_agg(distinct prm.modulo_codice) from departments d join public.progremes_reparti_moduli prm on prm.reparto_id=d.reparto_id join public.progremes_moduli m on m.codice=prm.modulo_codice where m.attivo), array[]::text[]) end
  from profile p where nullif(btrim(coalesce(p.email,'')),'') is not null;
end;
$$;

revoke all on function public.consume_progremes_sso_ticket(text) from public, anon, authenticated;
grant execute on function public.consume_progremes_sso_ticket(text) to service_role;

commit;

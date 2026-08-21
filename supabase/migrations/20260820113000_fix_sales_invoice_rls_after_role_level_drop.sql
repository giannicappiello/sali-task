begin;

create or replace function public.can_view_mexal_sales_invoice(p_agent_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select
      u.id,
      coalesce(r.amministratore_workspace, false) as workspace_admin,
      coalesce(r.livello_accesso, 'lettura') as livello_accesso,
      lower(btrim(coalesce(r.nome, ''))) as ruolo
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
  )
  select exists (
    select 1
    from me
    where workspace_admin
       or livello_accesso = 'amministrazione'
       or ruolo in ('admin', 'administrator', 'amministratore', 'super admin', 'direzione')
  )
  or exists (
    select 1
    from public.integrazioni_utenti iu
    join me on me.id = iu.utente_id
    where iu.enabled is true
      and iu.modulo in ('gestione_ordini_pr', 'gestione_ordini_ph')
      and iu.ruolo_ordini = 'backoffice'
  )
  or nullif(btrim(coalesce(p_agent_code, '')), '') in (
    select public.visible_mexal_agent_codes()
  );
$$;

revoke all on function public.can_view_mexal_sales_invoice(text) from public, anon;
grant execute on function public.can_view_mexal_sales_invoice(text) to authenticated, service_role;

commit;

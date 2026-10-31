-- Run against an existing deployment after the visibility migration. No data persists.
begin;
set local lock_timeout='5s';
do $$declare v_auth uuid;begin
 select auth_user_id into strict v_auth from public.utenti u
 where lower(to_jsonb(u)->>'nome')='raffaella' and lower(to_jsonb(u)->>'cognome')='orizzonte'
 and attivo is not false and auth_user_id is not null;
 perform set_config('request.jwt.claim.sub',v_auth::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_auth,'role','authenticated')::text,true);
end;$$;
create temporary table expected_agent_invoices as
 select f.id from public.mexal_fatture_vendita f
 where public.normalize_mexal_agent_code(f.codice_agente_mexal) in
 (select public.normalize_mexal_agent_code(code) from public.visible_mexal_agent_codes() code);
create temporary table expected_agent_links as
 select distinct a.ordine_id,a.fattura_id from public.workspace_order_invoice_associations a
 join expected_agent_invoices f on f.id=a.fattura_id;
grant select on expected_agent_invoices,expected_agent_links to authenticated;
set local role authenticated;
do $$begin
 if (select public.workspace_data_scope()->>'commercial_mode')<>'propri' then raise exception 'Expected own-agent scope';end if;
 if not exists(select 1 from expected_agent_invoices) then raise exception 'No own invoices available for regression';end if;
 if exists(select id from expected_agent_invoices except select id from public.mexal_fatture_vendita) then raise exception 'Own invoices are hidden';end if;
 if exists(select id from public.mexal_fatture_vendita except select id from expected_agent_invoices) then raise exception 'Other agents invoices exposed';end if;
 if not exists(select 1 from expected_agent_links) then raise exception 'No linked orders available for regression';end if;
 if exists(select ordine_id,fattura_id::text from expected_agent_links except select ordine_id,invoice->>'id' from public.workspace_order_invoice_links(array(select id from public.ordini_testate))) then raise exception 'Own order links hidden';end if;
end;$$;
select jsonb_build_object('invoices_visible',(select count(*) from public.mexal_fatture_vendita),'linked_orders_visible',(select count(distinct ordine_id) from public.workspace_order_invoice_links(array(select id from public.ordini_testate))),'foreign_invoices_visible',(select count(*) from public.mexal_fatture_vendita f where not exists(select 1 from expected_agent_invoices e where e.id=f.id))) verification;
reset role;
rollback;

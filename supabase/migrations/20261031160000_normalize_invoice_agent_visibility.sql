begin;
set local lock_timeout='5s';
-- Compare both sides in the same format: e.g. 602.00063 and 63 identify one agent.
-- Preserve the customer-account boundary and existing organization-wide access.
alter policy "fatture vendita visibili per organizzazione" on public.mexal_fatture_vendita using (
 case when (select public.workspace_current_customer_code()) is not null
 then codice_cliente=any((select public.workspace_current_customer_codes())::text[])
 else (select public.workspace_data_scope()->>'commercial_mode')='tutti'
 or public.normalize_mexal_agent_code(codice_agente_mexal) in (
 select public.normalize_mexal_agent_code(code) from public.visible_mexal_agent_codes() code
 ) end
);
notify pgrst,'reload schema';
commit;

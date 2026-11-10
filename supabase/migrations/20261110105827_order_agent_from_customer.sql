begin;

-- The customer directory is authoritative; the uploader and a supplied header
-- agent must never change ownership. Keep the name snapshot aligned as well.
create or replace function public.set_order_agent_name()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare customer_agent text;
begin
  select nullif(btrim(customer.codice_agente_mexal), '')
    into customer_agent
    from public.ordini_clienti_cache customer
    where customer.codice_cliente = new.codice_cliente;
  new.codice_agente_mexal := customer_agent;
  new.agente_nome := public.resolve_mexal_agent_name(customer_agent);
  return new;
end;
$$;

drop trigger if exists ordini_testate_agent_name on public.ordini_testate;
create trigger ordini_testate_agent_name
before insert or update of codice_cliente, codice_agente_mexal, agente_nome
on public.ordini_testate
for each row execute function public.set_order_agent_name();

revoke all on function public.set_order_agent_name() from public, anon, authenticated;
comment on function public.set_order_agent_name() is
  'Order header agent and name always come from the linked customer, independently of uploader, supplied agent or import channel.';

-- Repair only missing historical agents. Preserve non-empty historical
-- assignments: a later change of customer ownership is not a history rewrite.
with repaired as (
  update public.ordini_testate orders
  set codice_agente_mexal = nullif(btrim(customer.codice_agente_mexal), '')
  from public.ordini_clienti_cache customer
  where customer.codice_cliente = orders.codice_cliente
    and nullif(btrim(orders.codice_agente_mexal), '') is null
    and nullif(btrim(customer.codice_agente_mexal), '') is not null
  returning orders.id, orders.codice_cliente, orders.codice_agente_mexal, orders.agente_nome
)
insert into public.crm_audit_log(utente_id, entita_tipo, entita_id, operazione, dettagli)
select public.workspace_current_profile_id(), 'ordini_testate', id,
  'order_missing_agent_restored_from_customer',
  jsonb_build_object('customer_code', codice_cliente, 'previous_agent', null,
    'agent_code', codice_agente_mexal, 'agent_name', agente_nome,
    'request_reference', '20261110104843_order_agent_from_customer',
    'reason', 'Agente testata ricavato dall’anagrafica cliente su richiesta esplicita; nessuna modifica ai documenti Mexal.')
from repaired;

commit;

-- Preserve all existing access rules; statement init plans evaluate request permissions once.
alter policy "crm accounts scoped read" on public.crm_accounts using (
((case tipo when 'conto_terzi' then (select public.crm_has_module_level('crm_conto_terzi','lettura')) when 'b2b' then (select public.crm_has_module_level('crm_b2b','lettura')) when 'online' then (select public.crm_has_module_level('crm_online','lettura')) when 'brand_direct' then (select public.crm_has_module_level('crm_brand_direct','lettura')) else false end) and coalesce((select public.workspace_data_scope())->>'mode'='tutti'
 or responsabile_id=(select public.workspace_current_profile_id())
 or ((select public.workspace_data_scope())->>'mode'='team' and (
   (select public.workspace_data_scope())->'user_ids' ? responsabile_id::text
   or (select public.workspace_data_scope())->'department_ids' ? reparto_id::text)),false)) or (id='00000000-0000-4000-8000-000000000001'::uuid and tipo='brand_direct' and (select public.crm_has_module_level('crm_brand_direct','lettura'))));
alter policy "crm accounts scoped write" on public.crm_accounts using (
(((case tipo when 'conto_terzi' then (select public.crm_has_module_level('crm_conto_terzi','lettura')) when 'b2b' then (select public.crm_has_module_level('crm_b2b','lettura')) when 'online' then (select public.crm_has_module_level('crm_online','lettura')) when 'brand_direct' then (select public.crm_has_module_level('crm_brand_direct','lettura')) else false end) and coalesce((select public.workspace_data_scope())->>'mode'='tutti'
 or responsabile_id=(select public.workspace_current_profile_id())
 or ((select public.workspace_data_scope())->>'mode'='team' and (
   (select public.workspace_data_scope())->'user_ids' ? responsabile_id::text
   or (select public.workspace_data_scope())->'department_ids' ? reparto_id::text)),false)) and (case tipo when 'conto_terzi' then (select public.crm_has_module_level('crm_conto_terzi','scrittura')) when 'b2b' then (select public.crm_has_module_level('crm_b2b','scrittura')) when 'online' then (select public.crm_has_module_level('crm_online','scrittura')) when 'brand_direct' then (select public.crm_has_module_level('crm_brand_direct','scrittura')) else false end))) with check (
((case tipo when 'conto_terzi' then (select public.crm_has_module_level('crm_conto_terzi','lettura')) when 'b2b' then (select public.crm_has_module_level('crm_b2b','lettura')) when 'online' then (select public.crm_has_module_level('crm_online','lettura')) when 'brand_direct' then (select public.crm_has_module_level('crm_brand_direct','lettura')) else false end) and (case tipo when 'conto_terzi' then (select public.crm_has_module_level('crm_conto_terzi','scrittura')) when 'b2b' then (select public.crm_has_module_level('crm_b2b','scrittura')) when 'online' then (select public.crm_has_module_level('crm_online','scrittura')) when 'brand_direct' then (select public.crm_has_module_level('crm_brand_direct','scrittura')) else false end) and coalesce((select public.workspace_data_scope())->>'mode'='tutti'
 or coalesce(responsabile_id,(select public.workspace_current_profile_id()))=(select public.workspace_current_profile_id())
 or ((select public.workspace_data_scope())->>'mode'='team' and (
   (select public.workspace_data_scope())->'user_ids' ? coalesce(responsabile_id,(select public.workspace_current_profile_id()))::text
   or (select public.workspace_data_scope())->'department_ids' ? reparto_id::text)),false)));
alter policy "club_identity_boundary" on public.crm_accounts using (not (select public.club_external_identity())) with check (not (select public.club_external_identity()));

CREATE OR REPLACE FUNCTION public.crm_customer_country_catalog(p_crm_type text DEFAULT NULL::text)
 RETURNS TABLE(entity_key text, country_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 'mexal:' || customer.codice_cliente,
    nullif(upper(btrim(customer.paese)), '')
  from public.ordini_clienti_cache customer
  join public.crm_customer_classifications classification
    on classification.codice_cliente = customer.codice_cliente
  where (p_crm_type is null or classification.area_crm = p_crm_type)
    and (classification.codice_cliente in (select public.crm_visible_canonical_customer_codes()) and classification.area_crm = any((select public.crm_visible_customer_areas())::text[]))

  union all

  select 'crm:' || account.id::text,
    nullif(upper(btrim(account.paese)), '')
  from public.crm_accounts account
  where account.codice_cliente_mexal is null
    and (p_crm_type is null or account.tipo = p_crm_type)
    and ((case account.tipo when 'conto_terzi' then (select public.crm_has_module_level('crm_conto_terzi','lettura')) when 'b2b' then (select public.crm_has_module_level('crm_b2b','lettura')) when 'online' then (select public.crm_has_module_level('crm_online','lettura')) when 'brand_direct' then (select public.crm_has_module_level('crm_brand_direct','lettura')) else false end) and coalesce((select public.workspace_data_scope())->>'mode'='tutti'
 or account.responsabile_id=(select public.workspace_current_profile_id())
 or ((select public.workspace_data_scope())->>'mode'='team' and (
   (select public.workspace_data_scope())->'user_ids' ? account.responsabile_id::text
   or (select public.workspace_data_scope())->'department_ids' ? account.reparto_id::text)),false));
$function$
;

CREATE OR REPLACE FUNCTION public.crm_prospect_customer_details(p_crm_type text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_customer_status text DEFAULT 'active'::text)
 RETURNS TABLE(id uuid, nome text, stato text, stato_relazione text, valore_cliente numeric, email text, telefono text, ultima_attivita_il timestamp with time zone, prossima_attivita_il timestamp with time zone, opportunita_count bigint, crm_active boolean, crm_status_changed_at timestamp with time zone, crm_status_changed_by uuid, crm_status_reason text, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with visible as (
    select account.*,
      coalesce(status.crm_active, true) crm_active,
      status.changed_at crm_status_changed_at,
      status.changed_by crm_status_changed_by,
      status.reason crm_status_reason
    from public.crm_accounts account
    left join public.crm_customer_status status
      on status.customer_key = 'crm:' || account.id::text
    where account.tipo = p_crm_type
      and account.codice_cliente_mexal is null
      and ((case account.tipo when 'conto_terzi' then (select public.crm_has_module_level('crm_conto_terzi','lettura')) when 'b2b' then (select public.crm_has_module_level('crm_b2b','lettura')) when 'online' then (select public.crm_has_module_level('crm_online','lettura')) when 'brand_direct' then (select public.crm_has_module_level('crm_brand_direct','lettura')) else false end) and coalesce((select public.workspace_data_scope())->>'mode'='tutti'
 or account.responsabile_id=(select public.workspace_current_profile_id())
 or ((select public.workspace_data_scope())->>'mode'='team' and (
   (select public.workspace_data_scope())->'user_ids' ? account.responsabile_id::text
   or (select public.workspace_data_scope())->'department_ids' ? account.reparto_id::text)),false))
      and (nullif(btrim(p_search), '') is null
        or account.nome ilike '%' || btrim(p_search) || '%'
        or account.email ilike '%' || btrim(p_search) || '%')
      and (coalesce(p_customer_status, 'active') = 'all'
        or (p_customer_status = 'inactive' and not coalesce(status.crm_active, true))
        or (coalesce(p_customer_status, 'active') = 'active' and coalesce(status.crm_active, true)))
  )
  select visible.id, visible.nome, visible.stato, visible.stato_relazione,
    visible.valore_cliente, visible.email, visible.telefono,
    visible.ultima_attivita_il, visible.prossima_attivita_il,
    (select count(*)::bigint from public.crm_opportunities opportunity
      where opportunity.account_id = visible.id) opportunita_count,
    visible.crm_active, visible.crm_status_changed_at,
    visible.crm_status_changed_by, visible.crm_status_reason,
    count(*) over()::bigint total_count
  from visible
  order by visible.aggiornato_il desc, visible.id
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
$function$
;

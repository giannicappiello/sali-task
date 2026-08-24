begin;

-- Separate SELECT from mutating policies: WITH CHECK does not protect DELETE.
drop policy if exists "crm contacts through account" on public.crm_contacts;
create policy "crm contacts read" on public.crm_contacts for select to authenticated using (exists(select 1 from public.crm_accounts a where a.id=account_id and public.crm_row_visible(a.responsabile_id,a.reparto_id,public.crm_module_for_type(a.tipo))));
create policy "crm contacts write" on public.crm_contacts for all to authenticated using (exists(select 1 from public.crm_accounts a where a.id=account_id and public.crm_row_visible(a.responsabile_id,a.reparto_id,public.crm_module_for_type(a.tipo)) and public.crm_has_module_level(public.crm_module_for_type(a.tipo),'scrittura'))) with check (exists(select 1 from public.crm_accounts a where a.id=account_id and public.crm_row_visible(a.responsabile_id,a.reparto_id,public.crm_module_for_type(a.tipo)) and public.crm_has_module_level(public.crm_module_for_type(a.tipo),'scrittura')));

drop policy if exists "crm opportunities through account" on public.crm_opportunities;
create policy "crm opportunities read" on public.crm_opportunities for select to authenticated using (exists(select 1 from public.crm_accounts a where a.id=account_id and public.crm_row_visible(coalesce(responsabile_id,a.responsabile_id),coalesce(reparto_id,a.reparto_id),public.crm_module_for_type(a.tipo))));
create policy "crm opportunities write" on public.crm_opportunities for all to authenticated using (exists(select 1 from public.crm_accounts a where a.id=account_id and public.crm_has_module_level(public.crm_module_for_type(a.tipo),'scrittura') and public.crm_row_visible(coalesce(responsabile_id,a.responsabile_id),coalesce(reparto_id,a.reparto_id),public.crm_module_for_type(a.tipo)))) with check (exists(select 1 from public.crm_accounts a where a.id=account_id and public.crm_has_module_level(public.crm_module_for_type(a.tipo),'scrittura') and public.crm_row_visible(coalesce(responsabile_id,a.responsabile_id),coalesce(reparto_id,a.reparto_id),public.crm_module_for_type(a.tipo))));

drop policy if exists "crm activities scoped" on public.crm_activities;
create policy "crm activities read" on public.crm_activities for select to authenticated using (public.crm_row_visible(responsabile_id,reparto_id,public.crm_module_for_type(crm_tipo)));
create policy "crm activities write" on public.crm_activities for all to authenticated using (public.crm_row_visible(responsabile_id,reparto_id,public.crm_module_for_type(crm_tipo)) and public.crm_has_module_level(public.crm_module_for_type(crm_tipo),'scrittura')) with check (public.crm_row_visible(coalesce(responsabile_id,public.workspace_current_profile_id()),reparto_id,public.crm_module_for_type(crm_tipo)) and public.crm_has_module_level(public.crm_module_for_type(crm_tipo),'scrittura'));

drop policy if exists "crm briefs scoped" on public.crm_briefs;
create policy "crm briefs read" on public.crm_briefs for select to authenticated using (public.crm_row_visible(responsabile_id,reparto_id,public.crm_module_for_type(crm_tipo)));
create policy "crm briefs write" on public.crm_briefs for all to authenticated using (public.crm_row_visible(responsabile_id,reparto_id,public.crm_module_for_type(crm_tipo)) and public.crm_has_module_level(public.crm_module_for_type(crm_tipo),'scrittura')) with check (public.crm_row_visible(coalesce(responsabile_id,public.workspace_current_profile_id()),reparto_id,public.crm_module_for_type(crm_tipo)) and public.crm_has_module_level(public.crm_module_for_type(crm_tipo),'scrittura'));

drop policy if exists "crm brief messages scoped" on public.crm_brief_messages;
create policy "crm brief messages read" on public.crm_brief_messages for select to authenticated using (exists(select 1 from public.crm_briefs b where b.id=brief_id and public.crm_row_visible(b.responsabile_id,b.reparto_id,public.crm_module_for_type(b.crm_tipo))));
create policy "crm brief messages write" on public.crm_brief_messages for all to authenticated using (exists(select 1 from public.crm_briefs b where b.id=brief_id and public.crm_has_module_level('crm_ai','scrittura') and public.crm_row_visible(b.responsabile_id,b.reparto_id,public.crm_module_for_type(b.crm_tipo)))) with check (exists(select 1 from public.crm_briefs b where b.id=brief_id and public.crm_has_module_level('crm_ai','scrittura') and public.crm_row_visible(b.responsabile_id,b.reparto_id,public.crm_module_for_type(b.crm_tipo))));

drop policy if exists "crm decisions scoped" on public.crm_ai_decisions;
create policy "crm decisions read" on public.crm_ai_decisions for select to authenticated using (exists(select 1 from public.crm_briefs b where b.id=brief_id and public.crm_row_visible(b.responsabile_id,b.reparto_id,public.crm_module_for_type(b.crm_tipo))));
create policy "crm decisions write" on public.crm_ai_decisions for all to authenticated using (exists(select 1 from public.crm_briefs b where b.id=brief_id and public.crm_has_module_level('crm_ai','scrittura') and public.crm_row_visible(b.responsabile_id,b.reparto_id,public.crm_module_for_type(b.crm_tipo)))) with check (exists(select 1 from public.crm_briefs b where b.id=brief_id and public.crm_has_module_level('crm_ai','scrittura') and public.crm_row_visible(b.responsabile_id,b.reparto_id,public.crm_module_for_type(b.crm_tipo))));

drop policy if exists "crm campaigns scoped" on public.crm_campaigns;
create policy "crm campaigns read" on public.crm_campaigns for select to authenticated using (public.crm_row_visible(responsabile_id,reparto_id,'crm_online'));
create policy "crm campaigns write" on public.crm_campaigns for all to authenticated using (public.crm_row_visible(responsabile_id,reparto_id,'crm_online') and public.crm_has_module_level('crm_online','scrittura')) with check (public.crm_row_visible(coalesce(responsabile_id,public.workspace_current_profile_id()),reparto_id,'crm_online') and public.crm_has_module_level('crm_online','scrittura'));

drop policy if exists "crm creators scoped" on public.crm_creators;
create policy "crm creators read" on public.crm_creators for select to authenticated using (public.crm_row_visible(responsabile_id,reparto_id,'crm_online'));
create policy "crm creators write" on public.crm_creators for all to authenticated using (public.crm_row_visible(responsabile_id,reparto_id,'crm_online') and public.crm_has_module_level('crm_online','scrittura')) with check (public.crm_row_visible(coalesce(responsabile_id,public.workspace_current_profile_id()),reparto_id,'crm_online') and public.crm_has_module_level('crm_online','scrittura'));

drop policy if exists "crm creator contents scoped" on public.crm_creator_contents;
create policy "crm creator contents read" on public.crm_creator_contents for select to authenticated using (exists(select 1 from public.crm_creators c where c.id=creator_id and public.crm_row_visible(c.responsabile_id,c.reparto_id,'crm_online')));
create policy "crm creator contents write" on public.crm_creator_contents for all to authenticated using (exists(select 1 from public.crm_creators c where c.id=creator_id and public.crm_row_visible(c.responsabile_id,c.reparto_id,'crm_online') and public.crm_has_module_level('crm_online','scrittura'))) with check (exists(select 1 from public.crm_creators c where c.id=creator_id and public.crm_row_visible(c.responsabile_id,c.reparto_id,'crm_online') and public.crm_has_module_level('crm_online','scrittura')));

drop policy if exists "crm customer events scoped" on public.crm_customer_events;
create policy "crm customer events read" on public.crm_customer_events for select to authenticated using (exists(select 1 from public.crm_accounts a where a.id=account_id and a.tipo='online' and public.crm_row_visible(a.responsabile_id,a.reparto_id,'crm_online')));
create policy "crm customer events write" on public.crm_customer_events for all to authenticated using (exists(select 1 from public.crm_accounts a where a.id=account_id and a.tipo='online' and public.crm_row_visible(a.responsabile_id,a.reparto_id,'crm_online') and public.crm_has_module_level('crm_online','scrittura'))) with check (exists(select 1 from public.crm_accounts a where a.id=account_id and a.tipo='online' and public.crm_row_visible(a.responsabile_id,a.reparto_id,'crm_online') and public.crm_has_module_level('crm_online','scrittura')));

drop policy if exists "crm entity tags" on public.crm_entity_tags;
create policy "crm entity tags read" on public.crm_entity_tags for select to authenticated using (public.crm_has_module_level('crm','lettura'));
create policy "crm entity tags write" on public.crm_entity_tags for all to authenticated using (public.crm_has_module_level('crm','scrittura')) with check (public.crm_has_module_level('crm','scrittura'));

commit;

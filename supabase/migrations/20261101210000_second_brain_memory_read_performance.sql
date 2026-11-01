-- Keep the same visibility rules. Evaluate request-wide authorization once,
-- rather than rebuilding the access context for every imported memory fragment.
alter policy second_brain_memory_read on public.second_brain_memory using (
 (select public.second_brain_enabled())
 and (scope='company' or (scope='personal' and owner_id=(select public.workspace_current_profile_id()))
   or (scope='department' and public.second_brain_department_member(department_id)))
 and (project_id is null or exists(select 1 from public.v4_progetti p where p.id=project_id))
);
alter policy second_brain_proposals_read on public.second_brain_proposals using (
 (select public.second_brain_enabled()) and user_id=(select public.workspace_current_profile_id())
);
alter policy second_brain_calls_read on public.second_brain_calls using (
 user_id=(select public.workspace_current_profile_id())
);

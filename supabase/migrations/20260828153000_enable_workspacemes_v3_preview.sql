-- Attiva esclusivamente la preview V3, priva di effetti produttivi.
-- Conferma/esecuzione V3 resta governata dal flag indipendente e rimane OFF.
update public.workspace_v3_feature_flags
set enabled = true,
    updated_at = now()
where key = 'workspacemes.v3.preview';

do $$
begin
  if not exists (
    select 1
    from public.workspace_v3_feature_flags
    where key = 'workspacemes.v3.preview'
      and enabled = true
  ) then
    raise exception 'WORKSPACEMES_V3_PREVIEW_FLAG_MISSING';
  end if;
end;
$$;

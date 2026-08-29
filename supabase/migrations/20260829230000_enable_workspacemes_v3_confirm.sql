-- Il collaudo end-to-end WorkspaceMES V3 e i gate produttivi ProgreMES
-- risultano attivi: abilita la conferma che materializza OP e fabbisogni.
insert into public.workspace_v3_feature_flags (key, enabled, description, updated_at, updated_by)
values (
  'workspacemes.v3.confirm',
  true,
  'Abilita saga di conferma V3 e materializzazione impegni/fabbisogni.',
  now(),
  null
)
on conflict (key) do update
set enabled = excluded.enabled,
    description = excluded.description,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

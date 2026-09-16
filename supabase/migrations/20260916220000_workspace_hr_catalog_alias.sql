begin;
-- The HR module was recreated in the catalog as human_resources.
-- Both codes refer to the same independent employee membership.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.workspace_module_enabled_for_user(uuid,text)'::regprocedure) into definition;
  if position('when target_module=''hr'' then' in definition)=0
    or position('on m.codice=target_module' in definition)=0 then
    raise exception 'Review module resolver before applying HR alias';
  end if;
  definition:=replace(definition,'when target_module=''hr'' then','when target_module in (''hr'',''human_resources'') then');
  definition:=replace(definition,'on m.codice=target_module',
    'on (m.codice=target_module or (target_module=''hr'' and m.codice=''human_resources'' and not exists(select 1 from workspace_moduli where codice=''hr'')))');
  execute definition;
end $$;
do $$
declare definition text;
begin
  select pg_get_functiondef('public.workspace_screen_level_for_user(uuid,text)'::regprocedure) into definition;
  if position('when s.metadati->>''admin_only''=''true'' then ''nessuno''' in definition)=0 then
    raise exception 'Review screen resolver before applying HR access';
  end if;
  definition:=replace(definition,'when s.metadati->>''admin_only''=''true'' then ''nessuno''',
    'when s.metadati->>''admin_only''=''true'' then ''nessuno''
     when target_screen=''hr'' then case when workspace_module_enabled_for_user(t.id,''hr'') then ''scrittura'' else ''nessuno'' end');
  execute definition;
end $$;
update public.workspace_access_revision set revision=revision+1 where id;
notify pgrst, 'reload schema';
commit;

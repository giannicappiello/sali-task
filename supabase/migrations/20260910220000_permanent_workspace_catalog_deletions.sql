begin;
create table public.workspace_catalog_deletions (
  kind text not null check (kind in ('module','screen')),
  code text not null,
  external_code text,
  deleted_at timestamptz not null default now(),
  primary key(kind,code)
);
alter table public.workspace_catalog_deletions enable row level security;
create policy catalog_deletions_admin_read on public.workspace_catalog_deletions for select to authenticated using(public.workspace_user_is_admin());
grant select on public.workspace_catalog_deletions to authenticated;
grant all on public.workspace_catalog_deletions to service_role;

create function public.remember_workspace_catalog_deletion() returns trigger
language plpgsql security definer set search_path=public as $$
declare k text; external text;
begin
  k := case when tg_table_name='workspace_moduli' then 'module' else 'screen' end;
  if k='module' then
    select codice into external from public.progremes_moduli where public.workspace_progremes_module_code(codice)=old.codice limit 1;
  elsif old.provider='progremes' then
    external := coalesce(nullif(old.metadati->>'external_code',''),regexp_replace(old.codice,'^progremes\.',''));
  end if;
  insert into public.workspace_catalog_deletions(kind,code,external_code) values(k,old.codice,external) on conflict do nothing;
  return old;
end $$;
create trigger remember_deleted_module before delete on public.workspace_moduli for each row execute function public.remember_workspace_catalog_deletion();
create trigger remember_deleted_screen before delete on public.workspace_schermate for each row execute function public.remember_workspace_catalog_deletion();

create function public.skip_deleted_workspace_catalog_entry() returns trigger
language plpgsql security definer set search_path=public as $$
declare k text;
begin
  k := case when tg_table_name='workspace_moduli' then 'module' else 'screen' end;
  if exists(select 1 from public.workspace_catalog_deletions where kind=k and code=new.codice) then return null; end if;
  return new;
end $$;
create trigger aa_skip_deleted_module before insert or update on public.workspace_moduli for each row execute function public.skip_deleted_workspace_catalog_entry();
create trigger aa_skip_deleted_screen before insert or update on public.workspace_schermate for each row execute function public.skip_deleted_workspace_catalog_entry();

create function public.skip_deleted_progremes_catalog_entry() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.workspace_catalog_deletions where kind='module' and code=public.workspace_progremes_module_code(new.codice)) then return null; end if;
  return new;
end $$;
create trigger aa_skip_deleted_progremes_module before insert or update on public.progremes_moduli for each row execute function public.skip_deleted_progremes_catalog_entry();

-- Ignore legacy automatic links referencing entries deliberately removed.
create function public.skip_deleted_catalog_link() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.workspace_catalog_deletions where (kind='module' and code=new.modulo_codice) or (kind='screen' and code=new.schermata_codice)) then return null; end if;
  return new;
end $$;
create trigger aa_skip_deleted_catalog_link before insert or update on public.workspace_moduli_schermate for each row execute function public.skip_deleted_catalog_link();

create function public.admin_delete_workspace_screen(target_code text) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not public.workspace_user_is_admin() then raise exception 'Operazione riservata all''amministratore Workspace.'; end if;
  delete from public.workspace_schermate where codice=target_code;
end $$;
revoke all on function public.admin_delete_workspace_screen(text) from public,anon;
grant execute on function public.admin_delete_workspace_screen(text) to authenticated;
commit;

-- Repair del gate CRM PRIVATE -> Workspace.
-- L'assegnatario applicativo e il profilo public.utenti, come gia usato da UI e workflow.

begin;

do $$
declare
  referenced_table text;
begin
  select constraint_target.relname
  into referenced_table
  from pg_constraint constraint_row
  join pg_class constraint_target on constraint_target.oid=constraint_row.confrelid
  where constraint_row.conrelid='public.v4_fasi_progetto'::regclass
    and constraint_row.conname='v4_fasi_progetto_assegnato_a_fkey';

  if referenced_table is distinct from 'utenti' then
    if exists (
      select 1 from public.v4_fasi_progetto phase
      where phase.assegnato_a is not null
        and not exists (select 1 from public.utenti profile where profile.id=phase.assegnato_a)
    ) then
      raise exception 'Impossibile riallineare assegnato_a: esistono riferimenti non riconducibili a public.utenti';
    end if;

    alter table public.v4_fasi_progetto drop constraint if exists v4_fasi_progetto_assegnato_a_fkey;
    alter table public.v4_fasi_progetto
      add constraint v4_fasi_progetto_assegnato_a_fkey
      foreign key (assegnato_a) references public.utenti(id) on delete set null;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

begin;

-- L'UUID resta l'identità tecnica usata da WorkspaceMES e ProgreMES.
-- Questo progressivo è esclusivamente l'identità operativa, stabile e leggibile.
create sequence if not exists public.workspace_production_rdp_number_seq as bigint;

alter table public.workspace_production_requests
  add column if not exists rdp_number bigint;

alter sequence public.workspace_production_rdp_number_seq
  owned by public.workspace_production_requests.rdp_number;

do $$
declare
  v_max bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('workspace_production_rdp_number', 0));

  select coalesce(max(rdp_number), 0) into v_max
  from public.workspace_production_requests;

  with numbered as (
    select id, v_max + row_number() over (order by created_at, id)::bigint as value
    from public.workspace_production_requests
    where rdp_number is null
  )
  update public.workspace_production_requests as request
  set rdp_number = numbered.value
  from numbered
  where request.id = numbered.id;

  select coalesce(max(rdp_number), 0) into v_max
  from public.workspace_production_requests;

  perform setval(
    'public.workspace_production_rdp_number_seq',
    greatest(v_max, 1),
    v_max > 0
  );
end $$;

alter table public.workspace_production_requests
  alter column rdp_number set default nextval('public.workspace_production_rdp_number_seq'),
  alter column rdp_number set not null;

create unique index if not exists workspace_production_requests_rdp_number_uniq
  on public.workspace_production_requests (rdp_number);

grant usage, select on sequence public.workspace_production_rdp_number_seq to service_role;

comment on column public.workspace_production_requests.rdp_number is
  'Progressivo operativo immutabile visualizzato come RDP<n>; external_id resta la chiave tecnica WorkspaceMES.';

commit;

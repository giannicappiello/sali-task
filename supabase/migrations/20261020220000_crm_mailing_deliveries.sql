begin;
create table public.crm_mailing_deliveries (
  id uuid primary key default gen_random_uuid(), connection_id uuid not null references public.crm_external_connections(id) on delete cascade,
  account_id uuid references public.crm_accounts(id) on delete set null,
  member_hash text not null,list_id text not null,campaign_id text not null,
  title text,sent_at timestamptz,delivery_status text not null,
  updated_at timestamptz not null default now(),unique(connection_id,list_id,campaign_id,member_hash)
);
create index crm_mailing_deliveries_account on public.crm_mailing_deliveries(account_id,sent_at desc);
alter table public.crm_mailing_deliveries enable row level security;
create policy mailing_delivery_read on public.crm_mailing_deliveries for select to authenticated using(
  not(select public.club_external_identity()) and account_id in(select id from public.crm_accounts)
  and connection_id in(select c.id from public.crm_external_connections c
    where public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'lettura'))
);
revoke all on public.crm_mailing_deliveries from public,anon,authenticated;
grant select on public.crm_mailing_deliveries to authenticated;
grant all on public.crm_mailing_deliveries to service_role;

alter function public.crm_import_commerce_page_service(uuid,uuid,jsonb,text,jsonb,jsonb) rename to crm_import_commerce_before_mailing_service;
create function public.crm_import_commerce_page_service(target_connection_id uuid,target_run_id uuid,expected_state jsonb,resource_kind text,page_rows jsonb,next_state jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare c public.crm_external_connections; r jsonb; customer_account uuid;
begin
  if auth.role()<>'service_role' then raise exception 'Servizio riservato' using errcode='42501'; end if;
  if resource_kind<>'mailings' then
    perform public.crm_import_commerce_before_mailing_service(target_connection_id,target_run_id,expected_state,resource_kind,page_rows,next_state); return;
  end if;
  select * into strict c from public.crm_external_connections where id=target_connection_id for update;
  if not c.abilitata or c.provider_code<>'mailchimp' then raise exception 'Connessione mailing non abilitata'; end if;
  if c.import_state is distinct from expected_state then raise exception 'Cursore modificato: riprovare' using errcode='40001'; end if;
  if jsonb_array_length(page_rows)>100 or not exists(select 1 from public.crm_sync_runs where id=target_run_id and connection_id=c.id and status='running' and sync_type='commerce_import') then raise exception 'Pagina o lock non valido'; end if;
  for r in select value from jsonb_array_elements(page_rows) loop
    select account_id into customer_account from public.crm_external_customers where connection_id=c.id and external_id=r->>'member_hash';
    insert into public.crm_mailing_deliveries(connection_id,account_id,member_hash,list_id,campaign_id,title,sent_at,delivery_status)
    values(c.id,customer_account,r->>'member_hash',r->>'list_id',r->>'campaign_id',r->>'title',nullif(r->>'sent_at','')::timestamptz,r->>'status')
    on conflict(connection_id,list_id,campaign_id,member_hash) do update set account_id=excluded.account_id,title=excluded.title,sent_at=excluded.sent_at,delivery_status=excluded.delivery_status,updated_at=now();
  end loop;
  update public.crm_external_connections set import_state=next_state,ultimo_sync_il=now() where id=c.id;
end $$;
revoke all on function public.crm_import_commerce_page_service(uuid,uuid,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.crm_import_commerce_page_service(uuid,uuid,jsonb,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;

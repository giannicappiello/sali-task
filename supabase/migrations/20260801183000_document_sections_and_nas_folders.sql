create table if not exists public.sezioni_documentali (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cartella_nas text not null unique,
  descrizione text,
  ordinamento integer not null default 0,
  attiva boolean not null default true,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);

alter table public.documenti_workspace
  add column if not exists sezione_id uuid references public.sezioni_documentali(id) on delete set null;
create index if not exists documenti_workspace_sezione_idx on public.documenti_workspace(sezione_id, attivo);

insert into public.sezioni_documentali(nome, cartella_nas, descrizione, ordinamento)
values
  ('Schede tecniche', 'Schede Tecniche', 'Schede tecniche dei prodotti', 10),
  ('Cataloghi', 'Cataloghi', 'Cataloghi e materiali commerciali', 20),
  ('Video prodotti', 'Video Prodotti', 'Video dedicati ai singoli prodotti', 30),
  ('Video presentazioni', 'Video Presentazioni', 'Video di presentazione e di gamma', 40)
on conflict (cartella_nas) do nothing;

update public.documenti_workspace d
set sezione_id = s.id
from public.sezioni_documentali s
where d.sezione_id is null
  and (lower(d.categoria) = lower(s.nome) or lower(d.categoria) = lower(s.cartella_nas));

alter table public.sezioni_documentali enable row level security;
drop policy if exists "active users read document sections" on public.sezioni_documentali;
create policy "active users read document sections" on public.sezioni_documentali
for select to authenticated using (attiva and exists (
  select 1 from public.utenti u where u.auth_user_id=auth.uid() and u.attivo is not false
));
drop policy if exists "admins manage document sections" on public.sezioni_documentali;
create policy "admins manage document sections" on public.sezioni_documentali
for all to authenticated
using (exists (select 1 from public.utenti u left join public.ruoli r on r.id=u.ruolo_id where u.auth_user_id=auth.uid() and u.attivo is not false and (coalesce(r.livello,0)>=80 or lower(coalesce(r.nome,'')) in ('admin','administrator','amministratore','super admin','direzione'))))
with check (exists (select 1 from public.utenti u left join public.ruoli r on r.id=u.ruolo_id where u.auth_user_id=auth.uid() and u.attivo is not false and (coalesce(r.livello,0)>=80 or lower(coalesce(r.nome,'')) in ('admin','administrator','amministratore','super admin','direzione'))));
grant select,insert,update,delete on public.sezioni_documentali to authenticated;

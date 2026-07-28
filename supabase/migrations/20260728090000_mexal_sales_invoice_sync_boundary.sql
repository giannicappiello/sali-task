begin;

alter table public.mexal_fatture_sync_stato
  add column if not exists fte_trovate boolean not null default false,
  add column if not exists pagine_vuote_dopo_fte integer not null default 0;

update public.mexal_fatture_sync_stato
set fte_trovate = exists (select 1 from public.mexal_fatture_vendita),
    pagine_vuote_dopo_fte = case
      when exists (select 1 from public.mexal_fatture_vendita) then 3
      else 0
    end,
    aggiornato_il = now()
where id = 1;

commit;

-- Diagnostica preventiva (eseguire e risolvere manualmente eventuali righe restituite):
-- select auth_user_id, count(*) as profili
-- from public.utenti
-- where auth_user_id is not null
-- group by auth_user_id
-- having count(*) > 1;
--
-- Non elimina né modifica dati: crea l'unicità solo quando i dati sono già compatibili.
do $$
begin
  if not exists (
    select 1 from public.utenti
    where auth_user_id is not null
    group by auth_user_id
    having count(*) > 1
  ) then
    create unique index if not exists utenti_auth_user_id_unique
      on public.utenti (auth_user_id)
      where auth_user_id is not null;
  else
    raise warning 'Indice unico utenti.auth_user_id non creato: sono presenti profili duplicati';
  end if;
end $$;

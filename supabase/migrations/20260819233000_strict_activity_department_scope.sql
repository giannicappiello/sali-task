begin;

-- Questi ruoli operativi non devono ereditare l'accesso globale dai vecchi
-- livelli numerici. Vedono i propri dati e quelli collegati ai loro reparti.
update public.ruoli
set
  amministratore_workspace = false,
  ambito_dati = 'team'
where (
  lower(btrim(coalesce(nome, ''))) like '%fieldforce%'
  or lower(btrim(coalesce(nome, ''))) like '%beauty%consult%'
)
and lower(btrim(coalesce(nome, ''))) not in
  ('admin', 'administrator', 'amministratore', 'super admin');

commit;

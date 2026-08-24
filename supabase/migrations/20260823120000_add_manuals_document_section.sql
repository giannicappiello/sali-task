insert into public.sezioni_documentali (
  nome,
  cartella_nas,
  descrizione,
  ordinamento,
  attiva
)
values (
  'MANUALI D''USO',
  'ManualiUso',
  'Manuali d''uso e guide operative',
  50,
  true
)
on conflict (cartella_nas) do nothing;

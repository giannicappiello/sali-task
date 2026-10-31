begin;
set local lock_timeout='5s';
alter table public.warehouse_preparation_settings
  add column if not exists box_tare_kg numeric(10,3) check(box_tare_kg>=0 and box_tare_kg<=10000),
  add column if not exists pallet_tare_kg numeric(10,3) check(pallet_tare_kg>=0 and pallet_tare_kg<=10000);
commit;

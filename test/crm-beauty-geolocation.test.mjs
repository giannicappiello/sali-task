import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la migration Beauty è additiva, idempotente e conserva lo storico", async () => {
  const sql = await read("supabase/migrations/20260904210000_crm_beauty_visit_geolocation.sql");
  assert.match(sql, /create table if not exists public\.crm_visit_details/i);
  assert.match(sql, /legacy_giornata_id uuid unique/i);
  assert.match(sql, /idempotency_key=btrim\(p_idempotency_key\)/i);
  assert.doesNotMatch(sql, /drop table|truncate table|delete from public\.crm_/i);
});

test("geofence Beauty usa 150 metri, accuratezza e motivazione obbligatoria", async () => {
  const sql = await read("supabase/migrations/20260904210000_crm_beauty_visit_geolocation.sql");
  assert.match(sql, /p_accuracy > 100/i);
  assert.match(sql, /p_distance > 150/i);
  assert.match(sql, /Motivazione obbligatoria: rilevazione GPS/i);
});

test("check-out crea la prossima attività nella stessa operazione", async () => {
  const sql = await read("supabase/migrations/20260904210000_crm_beauty_visit_geolocation.sql");
  assert.match(sql, /create or replace function public\.crm_beauty_check_out/i);
  assert.match(sql, /Tipo, argomento e data della prossima attività sono obbligatori/i);
  assert.match(sql, /insert into public\.crm_activities/i);
});

test("le coordinate precise vengono anonimizzate dopo dodici mesi", async () => {
  const sql = await read("supabase/migrations/20260904210000_crm_beauty_visit_geolocation.sql");
  assert.match(sql, /crm_anonymize_expired_beauty_coordinates/i);
  assert.match(sql, /interval '12 months'/i);
  assert.match(sql, /crm-beauty-coordinate-retention/i);
});

test("la UI collega lo storico senza duplicarlo e richiede GPS solo al gesto utente", async () => {
  const [page, service] = await Promise.all([
    read("src/modules/pharmacy/pages/Giornate.jsx"),
    read("src/modules/pharmacy/services/beautyVisitCrm.js"),
  ]);
  assert.match(page, /ensureCrmBeautyVisit/);
  assert.match(page, /Check-in GPS/);
  assert.match(page, /Check-out e prossima attività/);
  assert.match(service, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(service, /beauty-legacy:/);
});

test("BeautyDays consente di pianificare un nuovo contatto CRM senza codice cliente", async () => {
  const [page, service, sql] = await Promise.all([
    read("src/modules/pharmacy/pages/Giornate.jsx"),
    read("src/modules/pharmacy/services/beautyVisitCrm.js"),
    read("supabase/migrations/20260904220000_crm_beauty_new_contact.sql"),
  ]);
  assert.match(page, /NUOVO CONTATTO/);
  assert.match(page, /Nome nuovo contatto/);
  assert.match(page, />Cliente</);
  assert.doesNotMatch(page, />Cliente Mexal</);
  assert.match(service, /createCrmBeautyContactVisit/);
  assert.match(service, /source_type", "beauty_crm"/);
  assert.match(sql, /Nome del nuovo contatto obbligatorio/i);
  assert.match(sql, /'prospect'/i);
  assert.doesNotMatch(sql, /drop table|truncate table|delete from public\.crm_/i);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const archive = await readFile(new URL("../src/pages/Activities/ActivityArchive.jsx", import.meta.url), "utf8");
const moduleSource = await readFile(new URL("../src/pages/Activities/ActivitiesModule.jsx", import.meta.url), "utf8");
const tasks = await readFile(new URL("../src/pages/Tasks/Tasks.jsx", import.meta.url), "utf8");
const projects = await readFile(new URL("../src/pages/Projects/Projects.jsx", import.meta.url), "utf8");
const reminders = await readFile(new URL("../src/pages/Agenda/Agenda.jsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260905190000_activity_archive_screen.sql", import.meta.url), "utf8");

test("l'archivio usa gli archivi canonici senza spostare o duplicare dati", () => {
  for (const table of ["v4_progetti", "v4_fasi_progetto", "agenda_reminder"]) assert.match(archive, new RegExp(`from\\(\\"${table}\\"\\)`));
  assert.doesNotMatch(migration, /\b(?:delete|truncate|update)\s+(?:from\s+)?public\.(?:v4_progetti|v4_fasi_progetto|agenda_reminder)\b/i);
  assert.match(migration, /"derived_view":true/);
});

test("l'archivio è una schermata del modulo Attività", () => {
  assert.match(moduleSource, /screenCode: "attivita\.archivio"/);
  assert.match(moduleSource, /path="archive"/);
  assert.match(migration, /'attivita','attivita\.archivio',50,false,true/);
});

test("le viste operative partono dai soli elementi attivi", () => {
  assert.match(tasks, /params\.get\("filter"\) \|\| "aperte"/);
  assert.match(projects, /useState\("aperti"\)/);
  assert.match(reminders, /reminders\.filter\(\(item\) => !isDone\(item\)\)/);
  assert.match(tasks, /to="\/activities\/archive\?type=tasks"/);
});

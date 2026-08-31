import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { buildMexalClient, loadMexalWarehouses } from "../server/mexal/sync-products.js";
import {
  loadWarehouseMovements,
  loadWarehouseProgressives,
  reconstructWarehouseSnapshots,
  upsertWarehouseSnapshots,
} from "../server/mexal/warehouse-history.js";

function loadEnv(path) {
  if (!fs.existsSync(path)) return {};
  const result = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!result[name] && !value.startsWith("xxxx")) result[name] = value;
  }
  return result;
}

Object.assign(process.env, loadEnv(".env"), loadEnv(".env.local"));
const dates = process.argv.slice(2).length ? process.argv.slice(2) : ["2026-08-29", "2026-08-30", "2026-08-31"];
if (dates.some((value) => !/^\d{4}-\d{2}-\d{2}$/.test(value))) throw new Error("Le date devono usare il formato YYYY-MM-DD.");

const db = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const activeCodes = new Set();
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("ordini_prodotti_cache").select("codice_articolo").eq("mostra_in_app", true).range(from, from + 999);
  if (error) throw error;
  for (const row of data || []) activeCodes.add(String(row.codice_articolo || "").trim().toUpperCase());
  if ((data || []).length < 1000) break;
}

const catalogClient = buildMexalClient({ warehouse: null });
const warehouses = await loadMexalWarehouses(catalogClient);
const currentRows = (await Promise.all(warehouses.map((warehouse) => (
  loadWarehouseProgressives(buildMexalClient({ warehouse: warehouse.number }), warehouse, activeCodes)
)))).flat();
const sortedDates = [...dates].sort();
const movements = await loadWarehouseMovements(catalogClient, sortedDates[0], sortedDates.at(-1));
const snapshots = reconstructWarehouseSnapshots(currentRows, movements, sortedDates);
await upsertWarehouseSnapshots(db, snapshots);

const result = sortedDates.map((snapshotDate) => {
  const rows = snapshots.filter((row) => row.snapshot_date === snapshotDate);
  return {
    snapshotDate,
    locations: rows.length,
    articles: new Set(rows.map((row) => row.article_code)).size,
    negativeArticles: new Set(rows.filter((row) => row.on_hand < 0).map((row) => row.article_code)).size,
    stockValue: rows.reduce((sum, row) => sum + (row.on_hand > 0 ? row.on_hand * row.unit_cost : 0), 0),
  };
});
console.log(JSON.stringify({ warehouses: warehouses.length, movements: movements.length, snapshots: result }, null, 2));

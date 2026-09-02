import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("la migration Magazzino e additiva e registra modulo, schermata e costo", async () => {
  const sql = await readFile("supabase/migrations/20260828223000_workspace_warehouse_module.sql", "utf8");
  assert.match(sql, /add column if not exists costo_ultimo/i);
  assert.match(sql, /costo_ult.*cos_ult/is);
  assert.match(sql, /'magazzino','Magazzino'/);
  assert.match(sql, /workspace_moduli_schermate/);
  assert.doesNotMatch(sql, /drop\s+(table|column)|delete\s+from\s+public\.prodotti/i);
});

test("il dettaglio per magazzino è additivo e non altera la cache ordini", async () => {
  const sql = await readFile("supabase/migrations/20260829080000_workspace_warehouse_stock_details.sql", "utf8");
  assert.match(sql, /create table if not exists public\.workspace_warehouse_stock/i);
  assert.match(sql, /primary key \(article_code, warehouse_number\)/i);
  assert.match(sql, /for select to authenticated using \(true\)/i);
  assert.doesNotMatch(sql, /alter table public\.ordini_prodotti_cache|delete\s+from/i);
});

test("la dashboard storica usa un solo dataset filtrato per righe KPI e grafici", async () => {
  const sql = await readFile("supabase/migrations/20260831225000_workspace_warehouse_historical_dashboard.sql", "utf8");
  assert.match(sql, /create table if not exists public\.workspace_warehouse_stock_history/i);
  assert.match(sql, /primary key \(snapshot_date, article_code, warehouse_number\)/i);
  assert.match(sql, /join parameters on history\.snapshot_date = parameters\.inventory_date/i);
  assert.match(sql, /filtered as[\s\S]*p_warehouse is null or inventory\.warehouse_number = p_warehouse/i);
  assert.match(sql, /from filtered group by article_type/i);
  assert.match(sql, /from filtered group by warehouse_number/i);
  assert.match(sql, /from filtered[\s\S]*limit \(select page_limit from parameters\)[\s\S]*offset \(select page_offset from parameters\)/i);
  assert.match(sql, /case when on_hand > 0 then on_hand \* unit_cost else 0 end/i);
  assert.match(sql, /negative_articles/i);
  assert.doesNotMatch(sql, /drop\s+(table|column)|truncate|delete\s+from/i);
});

test("l'interfaccia distingue data inventariale e ultimo aggiornamento e spiega i KPI", async () => {
  const page = await readFile("src/pages/Warehouse/WarehouseDashboard.jsx", "utf8");
  assert.match(page, /Giacenza al giorno/);
  assert.match(page, /Ultimo aggiornamento/);
  assert.match(page, /Articoli con giacenza negativa/);
  assert.match(page, /function InfoTip/);
  assert.match(page, /tabIndex=\{0\}/);
  assert.doesNotMatch(page, /Aggiornati dal|Aggiornati al|isoDay\(row\.sincronizzato_il\)/);
});

test("il Magazzino limita server-side gli account cliente ai propri articoli", async () => {
  const sql = await readFile("supabase/migrations/20260902170000_customer_private_orders_and_warehouse_scope.sql", "utf8");
  assert.match(sql, /customer_scope as materialized[\s\S]*workspace_current_customer_code\(\)/i);
  assert.match(sql, /customer_articles as materialized[\s\S]*join public\.ordini_righe/i);
  assert.match(sql, /customer_articles as materialized[\s\S]*join public\.mexal_fatture_vendita_righe/i);
  assert.match(sql, /scope\.customer_code is null[\s\S]*history\.article_code[\s\S]*customer_articles/i);
  assert.match(sql, /from filtered group by article_type/i);
  assert.match(sql, /from filtered group by warehouse_number/i);
  assert.match(sql, /'customerScoped', customer_scope\.customer_code is not null/i);
  assert.doesNotMatch(sql, /drop\s+(table|column)|truncate|delete\s+from/i);
});

test("la vista cliente aggrega per articolo e non espone riferimenti ai magazzini", async () => {
  const [sql, page] = await Promise.all([
    readFile("supabase/migrations/20260902171000_customer_warehouse_without_locations.sql", "utf8"),
    readFile("src/pages/Warehouse/WarehouseDashboard.jsx", "utf8"),
  ]);

  assert.match(sql, /where scope\.customer_code is not null[\s\S]*group by raw\.snapshot_date, raw\.article_code, raw\.unit_of_measure, raw\.article_type/i);
  assert.match(sql, /sum\(raw\.on_hand\)::numeric as on_hand/i);
  assert.match(sql, /scope\.customer_code is not null or p_warehouse is null/i);
  assert.match(sql, /where scope\.customer_code is null[\s\S]*group by warehouse_number/i);
  assert.match(sql, /to_jsonb\(item\) - 'warehouse_number' - 'warehouse_name' - 'source'/i);
  assert.match(page, /\{!customerScoped && <label><span>Magazzino<\/span>/);
  assert.match(page, /\{!customerScoped && <WarehouseKpis/);
  assert.match(page, /\{!customerScoped && <Donut title="Articoli per magazzino"/);
  assert.match(page, /\{!customerScoped && <th>Magazzino<\/th>\}/);
  assert.doesNotMatch(sql, /drop\s+(table|column)|truncate|delete\s+from/i);
});

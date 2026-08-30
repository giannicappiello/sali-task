import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const panel = read("src/modules/crm/CustomerClassificationPanel.jsx");
const crm = read("src/modules/crm/CrmModule.jsx");
const css = read("src/modules/crm/customer-classification.css");
const migration = read("supabase/migrations/20260830153000_crm_global_sales_distribution.sql");

test("la dashboard globale si aggiorna automaticamente e usa il periodo selezionato", () => {
  assert.match(panel, /AUTO_REFRESH_MS = 30_000/);
  assert.match(panel, /window\.setInterval\(refresh, AUTO_REFRESH_MS\)/);
  assert.match(panel, /visibilitychange/);
  assert.match(panel, /CrmPeriodFilter period=\{period\}/);
  assert.match(panel, /crm_global_sales_distribution/);
});

test("KPI e grafici distinguono fatturato, ordinato, ordini e pezzi", () => {
  for (const label of ["Fatturato", "Ordinato", "Numero ordini", "Pezzi fatturati", "Pezzi ordinati", "Distribuzione per categoria", "Distribuzione per sottocategoria"]) {
    assert.match(panel, new RegExp(label));
  }
  assert.match(panel, /Fatturato Mexal/);
  assert.match(panel, /Ordinato Workspace/);
  assert.match(css, /crm-sales-paired-bars/);
  assert.match(css, /@media\(max-width:640px\)/);
});

test("gli elenchi CRM mostrano importi netti e nascondono le colonne tecniche", () => {
  assert.doesNotMatch(panel, /<th>Cod\. alternativo<\/th>/);
  assert.doesNotMatch(panel, /<th>Nome ricerca<\/th>/);
  assert.doesNotMatch(panel, /<th>Ultima classificazione<\/th>/);
  assert.match(panel, /<th>Fatturato netto<\/th>/);
  assert.match(panel, /<th>Ordinato netto<\/th>/);
  assert.match(crm, /<th>Fatturato netto<\/th>/);
  assert.match(crm, /<th>Ordinato netto<\/th>/);
});

test("l'aggregazione server-side usa righe nette e categorie prodotto reali", () => {
  assert.match(migration, /crm_global_sales_distribution/);
  assert.match(migration, /line\.valore_netto/);
  assert.match(migration, /line\.totale_riga/);
  assert.match(migration, /product\.categoria_mexal/);
  assert.match(migration, /product\.sottocategoria_mexal/);
  assert.match(migration, /invoice_pieces/);
  assert.match(migration, /order_pieces/);
  assert.match(migration, /create or replace function public\.crm_customer_metric_details/);
});

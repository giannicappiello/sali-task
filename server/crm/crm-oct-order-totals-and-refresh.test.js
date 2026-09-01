import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260901083000_fix_crm_oct_order_totals.sql", import.meta.url),
  "utf8",
);
const dashboard = readFileSync(
  new URL("../../src/modules/crm/CommercialControlDashboard.jsx", import.meta.url),
  "utf8",
);

function referenceTotals(orders, scope) {
  const selected = orders.filter((order) => {
    const business = order.origine === "mexal_oct" && order.modulo_ordini === "private"
      ? "PRIVATE"
      : order.customerBusiness;
    if (scope === "private") return business === "PRIVATE";
    if (scope === "direct") return business === "DIRECT";
    return true;
  });
  return selected.reduce((result, order) => {
    const validLines = order.lines.filter((line) => !line.riga_descrittiva && line.mexal_attiva !== false);
    const amount = validLines.length
      ? validLines.reduce((sum, line) => sum + (line.totale_riga ?? line.imponibile_riga ?? ((line.quantita ?? 0) * (line.prezzo_netto ?? 0))), 0)
      : (order.totale_imponibile ?? order.totale_documento ?? 0);
    result.order_total += amount;
    result.order_count += 1;
    return result;
  }, { order_total: 0, order_count: 0 });
}

const workspaceOrder = {
  id: "workspace-1",
  origine: "workspace",
  modulo_ordini: "prof",
  customerBusiness: "DIRECT",
  lines: [{ totale_riga: 2500, riga_descrittiva: false, mexal_attiva: true }],
};
const privateOct = {
  id: "oct-1",
  origine: "mexal_oct",
  modulo_ordini: "private",
  customerBusiness: "DIRECT",
  classification: null,
  documents: ["OCT", "OCM", "OCI", "OCX"],
  lines: [
    { totale_riga: 10000, riga_descrittiva: false, mexal_attiva: true },
    { totale_riga: 999, riga_descrittiva: true, mexal_attiva: true },
    { totale_riga: 500, riga_descrittiva: false, mexal_attiva: false },
  ],
};

test("CASI A-E: ordini reali e OCT PRIVATE sono aggregati una sola volta", () => {
  assert.deepEqual(referenceTotals([workspaceOrder], "global"), { order_total: 2500, order_count: 1 });
  assert.deepEqual(referenceTotals([privateOct], "global"), { order_total: 10000, order_count: 1 });
  assert.deepEqual(referenceTotals([privateOct], "private"), { order_total: 10000, order_count: 1 });
  assert.deepEqual(referenceTotals([privateOct], "direct"), { order_total: 0, order_count: 0 });
  assert.deepEqual(referenceTotals([workspaceOrder, privateOct], "global"), { order_total: 12500, order_count: 2 });
});

test("la RPC parte dalle testate e rende autorevole il business OCT PRIVATE", () => {
  assert.match(migration, /create or replace function public\.crm_commercial_control_dashboard\(/i);
  assert.match(migration, /from public\.crm_order_kpi_source order_header/i);
  assert.match(migration, /left join public\.crm_customer_classifications classification/i);
  assert.match(migration, /order_header\.origine = 'mexal_oct' and order_header\.modulo_ordini = 'private' then 'PRIVATE'/i);
  assert.match(migration, /then 'conto_terzi'/i);
  assert.match(migration, /public\.crm_customer_classification_visible\(source\.customer_code, source\.crm_area\)/i);
  assert.doesNotMatch(migration, /join customers customer using \(codice_cliente\)/i);
});

test("valori di riga validi e testate deduplicate alimentano importo e order_count", () => {
  assert.match(migration, /not coalesce\(line\.riga_descrittiva, false\)/i);
  assert.match(migration, /coalesce\(line\.mexal_attiva, true\)/i);
  assert.match(migration, /line\.totale_riga[\s\S]*line\.imponibile_riga[\s\S]*line\.quantita \* line\.prezzo_netto/i);
  assert.match(migration, /count\(\*\)::bigint as order_count/i);
  assert.doesNotMatch(migration, /join public\.ordini_documenti_mexal/i);
});

test("tutti i filtri significativi restano nel dataset ordini", () => {
  for (const token of ["p_scope", "p_from", "p_to", "p_business", "p_market", "p_country", "p_agent", "p_channel", "p_customer"]) {
    assert.match(migration, new RegExp(token));
  }
});

test("la Dashboard carica solo all'apertura, al cambio filtro o su Aggiorna", () => {
  assert.match(dashboard, /const requestKey = useMemo\(\(\) => JSON\.stringify\(requestArguments\)/);
  assert.match(dashboard, /useEffect\(\(\) => \{[\s\S]*?Promise\.resolve\(\)\.then\(\(\) => \{/);
  assert.match(dashboard, /onClick=\{\(\) => void load\(\)\}/);
  assert.doesNotMatch(dashboard, /setInterval|AUTO_REFRESH_MS|visibilitychange|setTimeout/);
  assert.doesNotMatch(dashboard, /addEventListener\([^\n]*(?:focus|visibilitychange)/);
});

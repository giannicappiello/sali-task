import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyMexalDiscount, invoiceLines } from "../server/mexal/invoice-line-economics.js";

const lines = invoiceLines({
  codice_agente: "602.00058",
  id_riga: [[1, 1], [2, 2]],
  tp_riga: [[1, "R"], [2, "R"]],
  codice_articolo: [[1, "IT0001"], [2, "IT0002"]],
  descr_articolo: [[1, "Prodotto uno"], [2, "Prodotto due"]],
  quantita: [[1, 3], [2, 4]],
  prezzo: [[1, 10.5], [2, 12]],
  sconto: [[1, "10"], [2, ""]],
  cod_iva: [[1, " 22,0"], [2, "10,0"]],
  cod_agente: [[1, 1, "602.00058"], [2, 1, "602.00059"]],
});

assert.equal(lines.length, 2);
assert.deepEqual(lines[0], {
  posizione: 1,
  tipo_riga: "R",
  codice_articolo: "IT0001",
  descrizione: "Prodotto uno",
  quantita: 3,
  prezzo_unitario: 10.5,
  sconto: "10",
  sconto_percentuale_equivalente: 10,
  valore_lordo: 31.5,
  prezzo_netto_unitario: 9.45,
  valore_netto: 28.35,
  valore_netto_origine: "calcolato_da_sconto",
  aliquota_iva: 22,
  codice_agente_mexal: "602.00058",
  dati_mexal: {
    id_riga: 1,
    tipo_riga: "R",
    codice_articolo: "IT0001",
    descrizione: "Prodotto uno",
    quantita: 3,
    prezzo_unitario: 10.5,
    sconto: "10",
    aliquota_iva: " 22,0",
    codice_agente_mexal: "602.00058",
    prezzo_netto_mexal: null,
    valore_netto_mexal: null,
    sconti_merce_documento: [],
    prezzo_include_iva: false,
  },
});

assert.equal(applyMexalDiscount(100, "50+35"), 32.5);
assert.equal(applyMexalDiscount(100, "10,5"), 89.5);
assert.equal(applyMexalDiscount(100, "SC.MERCE"), 0);
assert.equal(applyMexalDiscount(100, "sconto libero"), null);
assert.equal(lines[1].valore_netto, 48);
assert.equal(lines[1].valore_netto_origine, "prezzo_pieno");

const mexalNetLine = invoiceLines({
  id_riga: [[1, 1]],
  quantita: [[1, 3]],
  prezzo: [[1, 10]],
  sconto: [[1, "10"]],
  prezzo_netto: [[1, 8.75]],
  imponibile_riga: [[1, 26.25]],
})[0];
assert.equal(mexalNetLine.prezzo_netto_unitario, 8.75);
assert.equal(mexalNetLine.valore_netto, 26.25);
assert.equal(mexalNetLine.valore_netto_origine, "mexal");

const reconciledCoxLine = invoiceLines({
  sigla: "CO",
  cod_modulo: "X",
  sc_merce_doc: [[1, 5]],
  id_riga: [[1, 1]],
  quantita: [[1, 3]],
  prezzo: [[1, 14.84]],
  cod_iva: [[1, "22,0"]],
})[0];
assert.equal(reconciledCoxLine.valore_netto, 34.667213);
assert.equal(reconciledCoxLine.valore_netto_origine, "calcolato_sconti_scorporo_iva");

const [migration, automation, moduleSource, dashboardSource, syncService, syncCard] = await Promise.all([
  readFile("supabase/migrations/20260728080000_mexal_sales_invoices.sql", "utf8"),
  readFile("api/mexal/automation.js", "utf8"),
  readFile("src/modules/orders/OrdersModule.jsx", "utf8"),
  readFile("src/modules/integrations/pages/MexalDashboard.jsx", "utf8"),
  readFile("src/modules/integrations/services/mexalSyncService.js", "utf8"),
  readFile("src/modules/integrations/components/MexalSyncCard.jsx", "utf8"),
]);
assert.match(migration, /sigla = 'FT'/);
assert.match(migration, /cod_modulo = 'E'/);
assert.match(migration, /can_view_mexal_sales_invoice/);
const netValuesMigration = await readFile("supabase/migrations/20260820110000_invoice_line_net_values_and_ai_context.sql", "utf8");
assert.match(netValuesMigration, /prezzo_netto_unitario numeric\(16,6\)/);
assert.match(netValuesMigration, /valore_netto numeric\(16,6\)/);
assert.match(netValuesMigration, /workspace_ai_sales_invoice_context/);
const invoiceRlsRepair = await readFile("supabase/migrations/20260820113000_fix_sales_invoice_rls_after_role_level_drop.sql", "utf8");
assert.match(invoiceRlsRepair, /amministratore_workspace/);
assert.match(invoiceRlsRepair, /livello_accesso = 'amministrazione'/);
assert.doesNotMatch(invoiceRlsRepair, /r\.livello(?:\W|$)/);
const optimizedInvoiceContext = await readFile("supabase/migrations/20260820114000_optimize_ai_sales_invoice_context.sql", "utf8");
assert.match(optimizedInvoiceContext, /security definer/);
assert.match(optimizedInvoiceContext, /access_context as materialized/);
assert.match(optimizedInvoiceContext, /visible_headers as materialized/);
assert.match(optimizedInvoiceContext, /visible_mexal_agent_codes/);
const reconciledNetValues = await readFile("supabase/migrations/20260820120000_reconcile_invoice_line_net_with_mexal_documents.sql", "utf8");
assert.match(reconciledNetValues, /sc_merce_doc/);
assert.match(reconciledNetValues, /calcolato_sconti_scorporo_iva/);
assert.match(reconciledNetValues, /discounted_value \/ \(1 \+ aliquota_iva \/ 100\)/);
assert.match(await readFile("supabase/migrations/20260728090000_mexal_sales_invoice_sync_boundary.sql", "utf8"), /pagine_vuote_dopo_fte/);
assert.match(await readFile("supabase/migrations/20260728100000_fill_sales_invoice_agent_from_client.sql", "utf8"), /ordini_clienti_cache/);
assert.match(automation, /sales_invoices: salesInvoicesHandler/);
assert.match(await readFile("server/mexal/sync-sales-invoices.js", "utf8"), /DETAIL_CONCURRENCY = 1/);
assert.match(await readFile("server/mexal/sync-sales-invoices.js", "utf8"), /emptyPagesAfterFte >= 3/);
assert.match(await readFile("server/mexal/invoice-line-economics.js", "utf8"), /sigla === "FT"/);
assert.match(await readFile("supabase/migrations/20260728170000_extend_sales_documents_fts_cox.sql", "utf8"), /cod_modulo in \('E', 'S'\)/);
assert.match(moduleSource, /path="fatture" element={<Invoices \/>}/);
assert.match(moduleSource, /fatture\/:invoiceId/);
assert.match(dashboardSource, /title: "Fatture"/);
assert.match(dashboardSource, /toggleSyncSchedule/);
assert.match(dashboardSource, /syncSchedules\[card\.type\]/);
assert.match(dashboardSource, /stopInvoiceSync/);
assert.match(dashboardSource, /cancelInvoiceSyncRef/);
assert.match(syncService, /invokeSalesInvoicesSync/);
assert.match(syncService, /structuredError\?\.message/);
assert.match(await readFile("server/mexal/lib/syncRuns.js", "utf8"), /"sales_invoices"/);
assert.match(syncCard, /Sincronizzazione automatica/);
assert.match(syncCard, /running && canStop/);

console.log("documenti FTE, FTS e COX: mapping righe, sicurezza, automazione e rotte verificati");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { invoiceLines } from "../server/mexal/sync-sales-invoices.js";

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
  aliquota_iva: 22,
  codice_agente_mexal: "602.00058",
  dati_mexal: {
    tipo_riga: "R",
    codice_articolo: "IT0001",
    descrizione: "Prodotto uno",
    quantita: 3,
    prezzo_unitario: 10.5,
    sconto: "10",
    aliquota_iva: " 22,0",
    codice_agente_mexal: "602.00058",
  },
});

const [migration, automation, moduleSource] = await Promise.all([
  readFile("supabase/migrations/20260728080000_mexal_sales_invoices.sql", "utf8"),
  readFile("api/mexal/automation.js", "utf8"),
  readFile("src/modules/orders/OrdersModule.jsx", "utf8"),
]);
assert.match(migration, /sigla = 'FT'/);
assert.match(migration, /cod_modulo = 'E'/);
assert.match(migration, /can_view_mexal_sales_invoice/);
assert.match(await readFile("supabase/migrations/20260728090000_mexal_sales_invoice_sync_boundary.sql", "utf8"), /pagine_vuote_dopo_fte/);
assert.match(await readFile("supabase/migrations/20260728100000_fill_sales_invoice_agent_from_client.sql", "utf8"), /ordini_clienti_cache/);
assert.match(automation, /sales_invoices: salesInvoicesHandler/);
assert.match(await readFile("server/mexal/sync-sales-invoices.js", "utf8"), /DETAIL_CONCURRENCY = 1/);
assert.match(moduleSource, /label: "Fatture"/);
assert.match(moduleSource, /fatture\/:invoiceId/);

console.log("fatture FTE: mapping righe, sicurezza, automazione e rotte verificati");

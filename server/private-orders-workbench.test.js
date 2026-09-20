import { productionCalendarRequest } from './hr-production-calendar.js';
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { privateWorkbenchSession, loadPrivateWorkbenchOrders, assertPrivateWorkbenchDetailScope } from "./private-orders-workbench.js";
import { listProductionWorkbench, productionWorkbenchDetail } from "./workspacemes-workbench.js";
import { privateWorkbenchMatchesSearch } from "../src/modules/orders/services/privateWorkbenchSearch.js";

function database(tables = {}, rpcs = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "AUTH" } } }) },
    rpc: async (name) => ({ data: rpcs[name] ?? null }),
    from(table) {
      let rows = [...(tables[table] || [])], single = false;
      const query = {
        select: () => query,
        eq: (key, value) => { rows = rows.filter((row) => row[key] === value); return query; },
        in: (key, values) => { rows = rows.filter((row) => values.includes(row[key])); return query; },
        order: (key, opts = {}) => { rows.sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * (opts.ascending === false ? -1 : 1)); return query; },
        limit: (n) => { rows = rows.slice(0, n); return query; },
        range: (a, b) => { rows = rows.slice(a, b + 1); return query; },
        maybeSingle: () => { single = true; return query; },
        then: (resolve, reject) => Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject),
      };
      return query;
    },
  };
}
const orders = [
  { id: "A", modulo_ordini: "private", origine: "mexal_oct", codice_cliente: "ALFA", codice_agente_mexal: "AG1", mexal_sigla: "OC", mexal_serie: "2", mexal_numero: 139, data_consegna: "2026-09-20" },
  { id: "B", modulo_ordini: "private", origine: "mexal_oct", codice_cliente: "BETA", codice_agente_mexal: "AG2" },
  { id: "PR", modulo_ordini: "prof", codice_cliente: "ALFA", codice_agente_mexal: "AG1" },
  { id: "DRAFT", modulo_ordini: "private", origine: "workspace", codice_cliente: "ALFA", codice_agente_mexal: "AG1", numero_ordine_visualizzato: "W/123", stato: "bozza" },
];
function session(scope, overrides = {}) {
  const admin = database({
    utenti: [{ id: "U", auth_user_id: "AUTH", attivo: true, ruoli: { amministratore_workspace: false }, ...overrides.profile }],
    integrazioni_utenti: [{ utente_id: "U", modulo: "gestione_ordini_private", enabled: overrides.enabled !== false }],
  }, { workspace_module_enabled_for_user: overrides.module !== false });
  const caller = database({ ordini_testate: orders }, {
    workspace_session_access: { scope, access: { role: { livello_accesso: "lettura" }, module_levels: { ordini_private: overrides.level || "lettura" } } },
    workspace_private_customer_codes: ["ALFA", "BETA"],
    visible_mexal_agent_codes: ["AG2"],
  });
  return privateWorkbenchSession({ headers: { authorization: "Bearer QA" } }, { admin, caller });
}
test("private director sees all PRIVATE, never PR; operational agents need not match", async () => {
  assert.deepEqual((await session({ mode: "team", commercial_mode: "team", private_commercial_read: true })).orders.map((o) => o.id).sort(), ["A", "B", "DRAFT"]);
});
test("multiple linked customers override global commercial scope and integration", async () => {
  assert.deepEqual((await session({ commercial_mode: "tutti", customer_codes: ["ALFA", "BETA"] }, { enabled: false })).orders.map((o) => o.id).sort(), ["A", "B", "DRAFT"]);
  assert.deepEqual((await session({ commercial_mode: "tutti", customer_codes: ["BETA"] })).orders.map((o) => o.id), ["B"]);
});
test("agent scope and no-scope fail closed", async () => {
  assert.deepEqual((await session({ mode: "team" })).orders.map((o) => o.id), ["B"]);
  assert.deepEqual(await loadPrivateWorkbenchOrders(database({ ordini_testate: orders }), { column: "codice_agente_mexal", values: [] }), []);
});
test("denies missing login, disabled account, module, integration and read level", async () => {
  await assert.rejects(privateWorkbenchSession({ headers: {} }), { status: 401 });
  for (const overrides of [{ profile: { attivo: false } }, { module: false }, { enabled: false }, { level: "nessuno" }]) {
    await assert.rejects(session({ commercial_mode: "tutti" }, overrides), { status: 403 });
  }
});
test("all pages are loaded without 500/1000-row truncation and drafts are retained", async () => {
  const many = Array.from({ length: 1103 }, (_, index) => ({ ...orders[0], id: String(index).padStart(5, "0") }));
  const result = await loadPrivateWorkbenchOrders(database({ ordini_testate: many.concat(orders[2]) }), null);
  assert.equal(result.length, 1103);
});
test("one shared source returns the exact Workbench quantities and per-article state", async () => {
  const tables = {
    ordini_testate: [orders[0]],
    ordini_clienti_cache: [{ codice_cliente: "ALFA", ragione_sociale: "Alfa Laboratori" }],
    ordini_righe: [
      { id: "L1", ordine_id: "A", mexal_posizione: 1, codice_articolo: "FPCOM38", descrizione: "Shampoo", quantita: 3000, quantita_evasa: 100, unita_misura_oct: "KG" },
      { id: "L2", ordine_id: "A", mexal_posizione: 2, codice_articolo: "FP220", descrizione: "Spray", quantita: 600, unita_misura_oct: "KG" },
      { id: "FOREIGN", ordine_id: "PR", codice_articolo: "SECRET", quantita: 100 },
    ],
    workspace_production_requests: [{ id: "R", ordine_id: "A", rdp_number: 16, workspace_status: "CONFIRMED" }],
  };
  const productionOrders = [{ numeroOrdine: "RDP16", riferimentoOct: "OC/2/139", codiceArticolo: "FPCOM38", stato: "InProduzione" }];
  const admin = database(tables);
  const actual = await listProductionWorkbench({ admin, productionOrders, scopedOrders: [orders[0]] });
  const original = await listProductionWorkbench({ admin, productionOrders });
  assert.deepEqual(actual.items, original.items);
  assert.equal(actual.items[0].customer, "Alfa Laboratori");
  assert.equal(actual.items[0].lines[0].residualQuantity, 2900);
  assert.equal(actual.items[0].lines[0].productionStatus, "IN PRODUZIONE");
  assert.notEqual(actual.items[0].lines[1].productionStatus, "IN PRODUZIONE");
  assert.equal(actual.items[0].lines.length, 2);
});
test("a foreign request cannot be opened using an owned order ID", async () => {
  const admin = database({ workspace_production_requests: [{ id: "R", ordine_id: "B" }] });
  await assert.rejects(productionWorkbenchDetail({ admin, requestId: "R", orderId: "A", allowedOrderIds: ["A"] }), { status: 404 });
  assert.throws(() => assertPrivateWorkbenchDetailScope(["A", "B"], ["A"]), { status: 404 });
  assert.doesNotThrow(() => assertPrivateWorkbenchDetailScope(["A", "B"], ["A", "B"]));
});
test("global search includes customer, product, RDP, article state and dates across all stages", () => {
  const row = { customer: "Alfà Laboratori", label: "OC/2/139", rdpNumber: 16, deliveryDate: "2026-09-20", stage: "production", lines: [{ articleCode: "FP220", description: "Crema Q 10", productionStatus: "PIANIFICATO" }] };
  for (const search of ["", "alfa crema", "q 10", "RDP16", "20/09/2026", "PIANIFICATO", "139"]) assert.equal(privateWorkbenchMatchesSearch(row, search), true, search);
  assert.equal(privateWorkbenchMatchesSearch(row, "cliente assente"), false);
});
test("Private navigation hides old lists; existing PR/PH navigation and creation remain", async () => {
  const source = await readFile(new URL("../src/modules/orders/OrdersModule.jsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/modules/orders/pages/PrivateOrdersDashboard.jsx", import.meta.url), "utf8");
  assert.match(source, /!privateModule && <OrdersModuleNavigation/);
  assert.match(source, /privateModule \? <PrivateOrdersDashboard \/> : <OrdersDashboard \/>/);
  assert.match(page, /Nuovo OCT/); assert.match(page, /Genera con AI/);
  assert.match(page, /<DetailPanel[^>]+readOnly/);
  assert.doesNotMatch(page, /rdp-tabs|Fabbisogni acquisto|Storico RdP|Ordini produzione MES|setInterval|enqueue/);
});

test('calendario cliente riusa la riconciliazione reale Produzioni senza ampliare il cliente', async () => {
 const admin = database({
  ordini_righe: [{id:'L1',ordine_id:'A',codice_articolo:'FP1',quantita:10}],
  workspace_production_requests: [{id:'R1',ordine_id:'A',rdp_number:16}],
 });
 const base={articleCode:'FP1',articleDescription:'Prodotto',start:'2026-09-20T08:00:00',end:'2026-09-20T16:00:00',status:'Pianificato',resourceCode:'ST7'};
 const result=await productionCalendarRequest({method:'GET',query:{from:'2026-09-01',to:'2026-09-30'}},{
  admin, authorize:async()=>({operations:['Production','Packaging'],orders:[orders[0]]}),
  readPlan:async()=>({items:[
   {...base,productionOrderId:1,orderNumber:'RDP16',operationType:'Production'},
   {...base,productionOrderId:1,orderNumber:'RDP16',operationType:'Packaging'},
   {...base,productionOrderId:2,orderNumber:'RDP160',operationType:'Production'},
  ]}),
 });
 assert.deepEqual(result.items.map(x=>x.operationType),['Production','Packaging']);
 assert.ok(result.items.every(x=>x.productionOrderId===1 && !x.resourceCode));
});

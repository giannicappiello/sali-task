import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  filterOrderModuleDocuments,
  filterOrderModuleRows,
  orderModuleAcceptsDocument,
  orderModuleFilter,
  orderModuleDocumentTypes,
} from "../../src/modules/orders/services/orderModules.js";
import { hasMexalDocuments } from "../../src/modules/orders/services/orderDisplayStatus.js";

test("OrdiniPR e OrdiniPH accettano soltanto OCM, OCX e OCI", () => {
  assert.deepEqual(orderModuleDocumentTypes("prof"), ["OCM", "OCX", "OCI"]);
  assert.deepEqual(orderModuleDocumentTypes("ph"), ["OCM", "OCX", "OCI"]);
  assert.equal(orderModuleAcceptsDocument("prof", "OCT"), false);
  assert.equal(orderModuleAcceptsDocument("ph", "OCT"), false);
});

test("OrdiniPR esclude sempre le testate OCT e non include più righe senza modulo", () => {
  assert.equal(orderModuleFilter("prof"), "modulo_ordini.eq.prof");
  assert.deepEqual(filterOrderModuleRows("prof", [
    { id: "pr", modulo_ordini: "prof", origine: "workspace" },
    { id: "oct-legacy", modulo_ordini: "prof", origine: "mexal_oct" },
    { id: "null", modulo_ordini: null, origine: "workspace" },
  ]).map((row) => row.id), ["pr"]);
});

test("OrdiniPrivate accetta soltanto OCT", () => {
  assert.deepEqual(orderModuleDocumentTypes("private"), ["OCT"]);
  assert.equal(orderModuleAcceptsDocument("private", "OCT"), true);
  assert.equal(orderModuleAcceptsDocument("private", "OCM"), false);
  assert.deepEqual(filterOrderModuleDocuments("private", [
    { tipo_documento: "OCT", numero: "12" },
    { tipo_documento: "OCX", numero: "99" },
  ]), [{ tipo_documento: "OCT", numero: "12" }]);
});

test("lo stato dell'ordine ignora documenti appartenenti all'altro modulo", () => {
  assert.equal(hasMexalDocuments({ modulo_ordini: "private", numero_ocm: "1" }), false);
  assert.equal(hasMexalDocuments({ modulo_ordini: "private", numero_oct: "2" }), true);
  assert.equal(hasMexalDocuments({ modulo_ordini: "prof", numero_oct: "2" }), false);
  assert.equal(hasMexalDocuments({ modulo_ordini: "prof", numero_oci: "3" }), true);
});

test("la navigazione OrdiniPrivate espone Dashboard, Clienti, Ordini e Fatture", async () => {
  const source = await readFile(new URL("../../src/modules/orders/OrdersModule.jsx", import.meta.url), "utf8");
  for (const path of ["dashboard", "clienti", "elenco", "fatture"]) {
    assert.match(source, new RegExp(`path: "${path}"`));
  }
});

test("migration e riconciliazione applicano il contratto documentale", async () => {
  const [migration, syncSource] = await Promise.all([
    readFile(new URL("../../supabase/migrations/20260829190000_isolate_order_module_documents.sql", import.meta.url), "utf8"),
    readFile(new URL("../mexal/sync-oct-orders.js", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /ORDINIPRIVATE' and tipo_documento = 'OCT'/);
  assert.match(migration, /ordini_private\.dashboard/);
  assert.match(migration, /ordini_private\.clienti/);
  assert.match(migration, /ordini_private\.fatture/);
  assert.match(syncSource, /\.eq\("modulo", "ORDINIPRIVATE"\)/);
});

test("l'importatore e il backfill classificano gli OCT come OrdiniPrivate", async () => {
  const [migration, syncSource] = await Promise.all([
    readFile(new URL("../../supabase/migrations/20260829201500_reclassify_oct_and_order_names.sql", import.meta.url), "utf8"),
    readFile(new URL("../mexal/sync-oct-orders.js", import.meta.url), "utf8"),
  ]);
  assert.match(syncSource, /modulo_ordini:\s*"private"/);
  assert.match(migration, /where origine = 'mexal_oct'/);
  assert.match(migration, /tipo_documento = 'OCT'/);
  assert.match(migration, /ragione_sociale_cliente = c\.ragione_sociale/);
});

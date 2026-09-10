import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isConfirmedMissingOct, reconcileDeletedOcts } from "./reconcile-deleted-octs.js";
import { visibleWorkbenchOct } from "../workspacemes-workbench.js";
import { normalizeOct, readMexalCollectionPages } from "./sync-oct-orders.js";

const missing = (status = 404) => Object.assign(new Error("Risorsa non trovata"), {
  status, mexalResponse: { status, body: JSON.stringify({ error: { "response-code": 1004, "response-message": "Risorsa specificata non trovata" } }) },
});
const order = (id, extra = {}) => ({ id, origine: "mexal_oct", mexal_cod_modulo: "T",
  mexal_sigla: "OC", mexal_serie: 2, mexal_numero: Number(id), mexal_anno: 2026,
  mexal_chiave: `OC+2+${Number(id)}`, mexal_sincronizzato_il: "2026-09-01T10:00:00Z",
  mexal_eliminato_il: null, ...extra });

function database(rows, { concurrentImport = false, rpcError = null } = {}) {
  const calls = [];
  const lines = rows.map((row) => ({ ordine_id: row.id, mexal_attiva: true }));
  const requests = [{ id: "rdp-1", ordine_id: rows[0]?.id }];
  return { rows, lines, requests, calls,
    from(table) {
      assert.equal(table, "ordini_testate");
      let filters = []; let limit = Infinity;
      const query = {
        select() { return query; },
        eq(k, v) { filters.push((row) => row[k] === v); return query; },
        is(k, v) { filters.push((row) => (row[k] ?? null) === v); return query; },
        gt(k, v) { filters.push((row) => row[k] > v); return query; },
        order() { return query; },
        limit(n) { limit = n; return query; },
        then(resolve, reject) { return Promise.resolve({ data: rows.filter((row) => filters.every((f) => f(row))).slice(0, limit), error: null }).then(resolve, reject); },
      };
      return query;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (rpcError) return { error: rpcError };
      if (concurrentImport) return { data: false };
      const row = rows.find((item) => item.id === args.p_order_id);
      row.mexal_eliminato_il = "2026-09-10T12:00:00Z";
      lines.filter((line) => line.ordine_id === row.id).forEach((line) => { line.mexal_attiva = false; });
      return { data: true };
    },
  };
}
function reconcile(supabase, getJson, extra = {}) {
  return reconcileDeletedOcts({ supabase, mexal: { getJson }, moduleCode: "T", year: 2026, ...extra });
}

test("ritira solo dopo risposta Mexal esplicita, conservando testata, righe e RdP", async () => {
  const db = database([order("001")]);
  const result = await reconcile(db, async (path) => {
    assert.equal(path, "/documenti/ordini-clienti/OC%2B2%2B1"); throw missing();
  });
  assert.equal(result.retired_orders, 1);
  assert.equal(db.rows.length, 1); assert.equal(db.lines.length, 1); assert.equal(db.requests.length, 1);
  assert.equal(db.lines[0].mexal_attiva, false);
  assert.equal(db.calls[0].name, "retire_deleted_mexal_oct");
  assert.equal(db.calls[0].args.p_seen_sync_at, "2026-09-01T10:00:00Z");
});

test("assenza nell'elenco filtrato non significa eliminazione: il GET positivo conserva l'OCT", async () => {
  const db = database([order("001")]);
  const result = await reconcile(db, async () => ({ sigla: "OC", serie: 2, numero: 1 }));
  assert.equal(result.retired_orders, 0); assert.equal(db.calls.length, 0);
});

test("timeout, permessi, 500, HTML 404 e messaggi generici non ritirano ordini", async () => {
  for (const error of [new Error("Timeout"), missing(403), missing(500),
    { status: 404, mexalResponse: { body: "<html>not found</html>" } },
    new Error("Errore 1004 o risorsa non trovata"), { status: 404, message: "Not found" }]) {
    assert.equal(isConfirmedMissingOct(error), false);
    const db = database([order("001")]);
    const result = await reconcile(db, async () => { throw error; });
    assert.equal(result.retired_orders, 0); assert.equal(result.deletion_check_errors, 1);
    assert.equal(db.calls.length, 0);
  }
});

test("la riconciliazione è limitata al modulo e all'anno configurati e salta OCT appena importati", async () => {
  const db = database([order("001"), order("002", { mexal_anno: 2025 }),
    order("003", { mexal_cod_modulo: "M" }), order("004", { origine: "workspace" }),
    order("005", { mexal_anno: null, data_ordine: "2026-09-01" })]);
  const paths = [];
  const result = await reconcile(db, async (path) => { paths.push(path); throw missing(); }, { importedKeys: new Set(["OC+2+1"]) });
  assert.equal(result.retired_orders, 1);
  assert.deepEqual(paths, ["/documenti/ordini-clienti/OC%2B2%2B5"]);
  const noYear = await reconcile(db, async () => { throw Error("Non chiamare Mexal"); }, { year: undefined });
  assert.equal(noYear.deletion_reconciliation, "skipped_missing_year");
});

test("pagina tutte le testate e un secondo passaggio non ritira due volte", async () => {
  const db = database(Array.from({ length: 205 }, (_, i) => order(String(i + 1).padStart(3, "0"))));
  const result = await reconcile(db, async () => { throw missing(); });
  assert.equal(result.retired_orders, 205);
  const retry = await reconcile(db, async () => { throw missing(); });
  assert.equal(retry.retired_orders, 0); assert.equal(retry.deletion_checks, 0);
});

test("un aggiornamento concorrente non viene contato come eliminato e un errore database non è ignorato", async () => {
  assert.equal((await reconcile(database([order("001")], { concurrentImport: true }), async () => { throw missing(); })).retired_orders, 0);
  await assert.rejects(reconcile(database([order("001")], { rpcError: new Error("Database unavailable") }), async () => { throw missing(); }), /Database unavailable/);
});

test("l'OCT eliminato sparisce dalla valutazione, senza nascondere lavorazioni e RdP collegate", () => {
  assert.equal(visibleWorkbenchOct({ sourceDeletedAt: "2026-09-10" }), false);
  assert.equal(visibleWorkbenchOct({ sourceDeletedAt: "2026-09-10", requestId: "rdp-1" }), true);
  assert.equal(visibleWorkbenchOct({ sourceDeletedAt: "2026-09-10", productionOrders: [{ id: 2 }] }), true);
  assert.equal(visibleWorkbenchOct({}), true);
});

test("un OCT ricreato in Mexal torna attivo alla nuova importazione", () => {
  const doc = normalizeOct({ sigla: "OC", cod_modulo: "T", serie: 2, numero: 1, righe: [] });
  assert.equal(doc.header.mexal_eliminato_il, null);
});

test("collection malformate o paginazione interrotta non arrivano alla riconciliazione", async () => {
  await assert.rejects(readMexalCollectionPages({ mexal: { getJson: async () => ({ error: "Unavailable" }) }, path: "/oct" }), /elenco documenti assente/);
  let calls = 0;
  await assert.rejects(readMexalCollectionPages({ mexal: { getJson: async () => {
    if (calls++) throw Error("Timeout pagina 2");
    return { dati: [], next: "pagina-2" };
  } }, path: "/oct" }), /Timeout pagina 2/);
});

test("migrazione atomica e riservata al servizio: nessuna cancellazione fisica o modifica delle lavorazioni", async () => {
  const sql = await readFile(new URL("../../supabase/migrations/20260910120000_reconcile_deleted_mexal_octs.sql", import.meta.url), "utf8");
  assert.match(sql, /mexal_sincronizzato_il is not distinct from p_seen_sync_at/);
  assert.match(sql, /revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /delete from|truncate|update public\.workspace_production/i);
});

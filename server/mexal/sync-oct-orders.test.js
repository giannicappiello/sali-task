import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeOct, precheckOctOrders } from "./sync-oct-orders.js";

const oct2412 = JSON.parse(fs.readFileSync(
  new URL("./fixtures/oct-2-412.parallel.json", import.meta.url),
  "utf8",
));

test("OCT 2/412 ricostruisce testata e matrici di riga sparse per indice", () => {
  const normalized = normalizeOct(oct2412);

  assert.equal(normalized.key, "OC+2+412");
  assert.deepEqual(
    {
      sigla: normalized.header.mexal_sigla,
      modulo: normalized.header.mexal_cod_modulo,
      serie: normalized.header.mexal_serie,
      numero: normalized.header.mexal_numero,
      cliente: normalized.header.codice_cliente,
      dataOrdine: normalized.header.data_ordine,
    },
    { sigla: "OC", modulo: "T", serie: 2, numero: 412, cliente: "501.00159", dataOrdine: "2026-08-06" },
  );
  assert.equal(normalized.lines.length, 3);
  assert.deepEqual(normalized.lines.map((line) => line.mexal_posizione), [1, 2, 3]);
  assert.deepEqual(normalized.lines.map((line) => line.mexal_tipo_riga), ["R", "D", "D"]);
  assert.deepEqual(normalized.lines.map((line) => line.codice_articolo), ["PB0004", null, null]);
  assert.deepEqual(normalized.lines.map((line) => line.descrizione), ["", "Prima nota descrittiva", "Seconda nota descrittiva"]);
  assert.deepEqual(normalized.lines.map((line) => line.quantita), [7000, 0, 0]);
  assert.deepEqual(normalized.lines.map((line) => line.riga_descrittiva), [false, true, true]);
  assert.equal(normalized.lines[0].data_consegna, "2026-09-15");
});

test("formato legacy righe[] resta supportato incluso dt_sca_riga", () => {
  const normalized = normalizeOct({
    sigla: "OC",
    cod_modulo: "T",
    serie: 2,
    numero: 413,
    data_documento: "2026-08-07",
    righe: [
      { id_riga: 10, tp_riga: "R", codice_articolo: "FP123", descr_riga: "Articolo legacy", quantita: 2, dt_sca_riga: "2026-09-20" },
      { id_riga: 20, tp_riga: "D", descr_riga: "Nota legacy" },
    ],
  });

  assert.deepEqual(normalized.lines, [
    {
      mexal_posizione: 10,
      codice_articolo: "FP123",
      descrizione: "Articolo legacy",
      quantita: 2,
      data_consegna: "2026-09-20",
      mexal_tipo_riga: "R",
      riga_descrittiva: false,
    },
    {
      mexal_posizione: 20,
      codice_articolo: null,
      descrizione: "Nota legacy",
      quantita: 0,
      data_consegna: null,
      mexal_tipo_riga: "D",
      riga_descrittiva: true,
    },
  ]);
});

function readonlySupabase(tables, calls) {
  return {
    from(table) {
      let rows = tables[table] || [];
      const query = {
        select(columns) {
          calls.push({ operation: "select", table, columns });
          return query;
        },
        eq(column, value) {
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        in(column, values) {
          rows = rows.filter((row) => values.includes(row[column]));
          return query;
        },
        then(resolve, reject) {
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      for (const operation of ["insert", "update", "upsert", "delete"]) {
        query[operation] = () => {
          throw new Error(`Il precheck ha tentato una scrittura ${operation} su ${table}`);
        };
      }
      return query;
    },
  };
}

async function runReadonlyPrecheck() {
  const missingCode = "MISS/%.-";
  const legacyOct = {
    sigla: "OC",
    cod_modulo: "T",
    serie: 2,
    numero: 413,
    cod_conto: "501.00999",
    data_documento: "2026-08-07",
    righe: [
      { id_riga: 10, tp_riga: "R", codice_articolo: missingCode, descr_riga: "Articolo assente", quantita: 2, dt_sca_riga: "2026-09-20" },
      { id_riga: 20, tp_riga: "D", descr_riga: "Nota senza codice articolo" },
    ],
  };
  const calls = [];
  const supabase = readonlySupabase({
    prodotti: [{ id: "product-pb0004", codice_mexal: "PB0004", attivo_mexal: true, mostra_in_app: true, sincronizzato_mexal: true, linea_mexal: "Standard" }],
    ordini_testate: [{ id: "order-2-412", origine: "mexal_oct", mexal_sigla: "OC", mexal_serie: 2, mexal_numero: 412, mexal_chiave: "OC+2+412" }],
    ordini_righe: [
      { id: "line-1", ordine_id: "order-2-412", mexal_posizione: 1 },
      { id: "line-2", ordine_id: "order-2-412", mexal_posizione: 2 },
      { id: "line-3", ordine_id: "order-2-412", mexal_posizione: 3 },
    ],
  }, calls);
  const details = new Map([
    ["/documenti/ordini-clienti/OC%2B2%2B412", oct2412],
    ["/documenti/ordini-clienti/OC%2B2%2B413", legacyOct],
  ]);
  const mexal = {
    async getJson(path) {
      if (path === "/oct") return { documenti: [{ sigla: "OC", serie: 2, numero: 412 }, { sigla: "OC", serie: 2, numero: 413 }] };
      if (details.has(path)) return details.get(path);
      throw new Error(`Percorso Mexal inatteso: ${path}`);
    },
  };

  const result = await precheckOctOrders({
    mexal,
    supabase,
    env: { MEXAL_OCT_MODULE_CODE: "T", MEXAL_OCT_LIST_PATH: "/oct" },
  });
  return { result, calls, missingCode };
}

test("precheck OCT resta read-only e non invoca operazioni mutanti", async () => {
  const { result, calls } = await runReadonlyPrecheck();

  assert.equal(result.dry_run, true);
  assert.equal(result.read_only, true);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((call) => call.operation === "select"));
});

test("precheck legge 2/412 e lo riconosce come già presente", async () => {
  const { result } = await runReadonlyPrecheck();
  const document = result.documents.find((item) => item.serie === 2 && item.numero === 412);

  assert.equal(result.candidate_oct_count, 2);
  assert.equal(document.key, "OC+2+412");
  assert.equal(document.cliente, "501.00159");
  assert.equal(document.already_in_workspace, true);
  assert.deepEqual(result.already_in_workspace.map((item) => item.key), ["OC+2+412"]);
});

test("righe descrittive non diventano articoli mancanti", async () => {
  const { result, missingCode } = await runReadonlyPrecheck();

  assert.equal(result.total_rows, 5);
  assert.equal(result.article_rows, 2);
  assert.equal(result.descriptive_rows, 3);
  assert.deepEqual(result.distinct_article_codes, ["PB0004", missingCode]);
  assert.deepEqual(result.workspace_articles_present, ["PB0004"]);
  assert.deepEqual(result.workspace_articles_missing, [missingCode]);
});

test("precheck preserva quantità, data ordine e dt_sca_riga", async () => {
  const { result, missingCode } = await runReadonlyPrecheck();
  const existingLine = result.documents.find((item) => item.numero === 412).lines[0];
  const missingLine = result.documents.find((item) => item.numero === 413).lines[0];

  assert.deepEqual(
    { dataOrdine: result.documents.find((item) => item.numero === 412).data_ordine, quantita: existingLine.quantita, dtSCA: existingLine.dt_sca_riga },
    { dataOrdine: "2026-08-06", quantita: 7000, dtSCA: "2026-09-15" },
  );
  assert.deepEqual(
    { codice: missingLine.codice_articolo, quantita: missingLine.quantita, dtSCA: missingLine.dt_sca_riga },
    { codice: missingCode, quantita: 2, dtSCA: "2026-09-20" },
  );
});

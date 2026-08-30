import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  classifyOctLines,
  createOctOrdersRunHandler,
  normalizeOct,
  precheckOctOrders,
  readMexalCollectionPages,
  syncOctOrders,
} from "./sync-oct-orders.js";

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
  assert.equal(normalized.header.data_consegna, "2026-09-15");
});

test("la consegna esplicita di testata prevale sulle scadenze delle righe", () => {
  const normalized = normalizeOct({
    sigla: "OC", cod_modulo: "T", serie: 2, numero: 414,
    data_documento: "2026-08-07", data_consegna: "2026-10-01",
    righe: [{ id_riga: 1, codice_articolo: "FP123", quantita: 2, dt_sca_riga: "2026-09-20" }],
  });
  assert.equal(normalized.header.data_consegna, "2026-10-01");
  assert.equal(normalized.lines[0].data_consegna, "2026-09-20");
});

test("formato legacy righe[] resta supportato incluso dt_sca_riga", () => {
  const normalized = normalizeOct({
    sigla: "OC",
    cod_modulo: "T",
    serie: 2,
    numero: 413,
    data_documento: "2026-08-07",
    righe: [
      { id_riga: 10, tp_riga: "R", codice_articolo: "FP123", descr_riga: "Articolo legacy", quantita: 2, unita_misura: "PZ", tp_um_articolo: "1", dt_sca_riga: "2026-09-20" },
      { id_riga: 20, tp_riga: "D", descr_riga: "Nota legacy" },
    ],
  });

  assert.deepEqual(normalized.lines, [
    {
      mexal_posizione: 10,
      codice_articolo: "FP123",
      descrizione: "Articolo legacy",
      quantita: 2,
      unita_misura_oct: "PZ",
      tipo_unita_misura_mexal: "1",
      data_consegna: "2026-09-20",
      mexal_tipo_riga: "R",
      riga_descrittiva: false,
      prezzo_listino: 0,
      sconto_commerciale: null,
      prezzo_netto: 0,
      aliquota_iva: 0,
      imponibile_riga: 0,
      iva_riga: 0,
      totale_riga: 0,
    },
    {
      mexal_posizione: 20,
      codice_articolo: null,
      descrizione: "Nota legacy",
      quantita: 0,
      unita_misura_oct: null,
      tipo_unita_misura_mexal: null,
      data_consegna: null,
      mexal_tipo_riga: "D",
      riga_descrittiva: true,
      prezzo_listino: 0,
      sconto_commerciale: null,
      prezzo_netto: 0,
      aliquota_iva: 0,
      imponibile_riga: 0,
      iva_riga: 0,
      totale_riga: 0,
    },
  ]);
});

test("OCT importato conserva prezzi, sconti e totali per i KPI CRM", () => {
  const normalized = normalizeOct({
    sigla: "OC", cod_modulo: "T", serie: 2, numero: 415,
    cod_conto: "501.00159", data_documento: "2026-08-08",
    id_riga: [[1, 1]], codice_articolo: [[1, "PB0004"]], quantita: [[1, 10]],
    prezzo: [[1, "12,50"]], sconto: [[1, "10+5"]], cod_iva: [[1, 22]],
  });

  assert.equal(normalized.lines[0].prezzo_netto, 10.6875);
  assert.equal(normalized.lines[0].imponibile_riga, 106.88);
  assert.equal(normalized.header.totale_imponibile, 106.88);
  assert.equal(normalized.header.totale_documento, 130.39);
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
    ordini_prodotti_cache: [{ codice_articolo: "PB0004", unita_misura: null, dati_mexal: { um_principale: "PZ" } }],
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
      if (path === "/oct?max=200") return { documenti: [{ sigla: "OC", serie: 2, numero: 412 }, { sigla: "OC", serie: 2, numero: 413 }] };
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

function line(overrides = {}) {
  return {
    mexal_posizione: 1,
    codice_articolo: "PB0004",
    descrizione: "Articolo valido",
    quantita: 2,
    unita_misura_oct: "PZ",
    tipo_unita_misura_mexal: "1",
    data_consegna: "2026-09-20",
    mexal_tipo_riga: "R",
    riga_descrittiva: false,
    ...overrides,
  };
}

test("classificazione accetta un articolo presente nella cache FK", () => {
  const result = classifyOctLines({ key: "OC+2+1", lines: [line()] }, new Set(["PB0004"]));
  assert.equal(result.valid.length, 1);
  assert.deepEqual(result.anomalies, []);
});

test("classificazione scarta fail-closed un articolo mancante senza inventare mapping", () => {
  const result = classifyOctLines({ key: "OC+2+1", lines: [line({ codice_articolo: "MISS-1" })] }, new Set(["PB0004"]), {
    context: { cycle_id: 152, job_id: 1411 },
    timestamp: "2026-08-26T10:00:00.000Z",
  });
  assert.deepEqual(result.valid, []);
  assert.deepEqual(result.anomalies, [{
    cycle_id: 152,
    job_id: 1411,
    oct: "OC+2+1",
    oct_line: 1,
    article_code: "MISS-1",
    line_type: "R",
    error_code: "OCT_ARTICLE_NOT_IN_ORDER_CACHE",
    message: "Articolo OCT non presente nell'anagrafica ordini sincronizzata.",
    timestamp: "2026-08-26T10:00:00.000Z",
  }]);
});

test("classificazione conserva righe descrittive e codici vuoti normalizzati come descrittivi", () => {
  const normalized = normalizeOct({
    sigla: "OC", cod_modulo: "T", serie: 2, numero: 2,
    righe: [{ id_riga: 1, tp_riga: "D", codice_articolo: "   ", descr_riga: "Nota" }],
  });
  const result = classifyOctLines(normalized, new Set());
  assert.equal(normalized.lines[0].codice_articolo, null);
  assert.equal(normalized.lines[0].riga_descrittiva, true);
  assert.equal(result.valid.length, 1);
  assert.deepEqual(result.anomalies, []);
});

test("normalizzazione applica trim senza cambiare semanticamente il case del codice", () => {
  const normalized = normalizeOct({
    sigla: "OC", cod_modulo: "T", serie: 2, numero: 3,
    righe: [{ id_riga: 1, tp_riga: "R", codice_articolo: "  It0064  ", quantita: 1 }],
  });
  assert.equal(normalized.lines[0].codice_articolo, "It0064");
  assert.equal(classifyOctLines(normalized, new Set(["It0064"])).valid.length, 1);
});

test("articolo dismesso assente dalla cache segue la stessa diagnostica fail-closed", () => {
  const result = classifyOctLines({ key: "OC+2+208", lines: [line({ codice_articolo: "IT0064" })] }, new Set());
  assert.equal(result.valid.length, 0);
  assert.equal(result.anomalies[0].article_code, "IT0064");
  assert.equal(result.anomalies[0].error_code, "OCT_ARTICLE_NOT_IN_ORDER_CACHE");
});

function writableSupabase() {
  const state = {
    ordini_prodotti_cache: [{ codice_articolo: "PB0004", unita_misura: null, dati_mexal: { um_principale: "PZ" } }],
    ordini_clienti_cache: [{ codice_cliente: "C1" }],
    ordini_documenti_mexal: [],
    ordini_testate: [],
    ordini_righe: [],
  };
  let nextOrder = 1;
  return {
    state,
    from(table) {
      let operation = "select";
      let payload;
      let filters = [];
      const query = {
        select() { return query; },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return query; },
        upsert(value) { operation = "upsert"; payload = value; return query; },
        update(value) { operation = "update"; payload = value; return query; },
        maybeSingle() { return execute(true); },
        single() { return execute(true); },
        then(resolve, reject) { return execute(false).then(resolve, reject); },
      };
      async function execute(single) {
        if (operation === "select") {
          const rows = (state[table] || []).filter((row) => filters.every((filter) => filter(row)));
          return { data: single ? rows[0] || null : rows, error: null };
        }
        if (operation === "update") {
          const rows = (state[table] || []).filter((row) => filters.every((filter) => filter(row)));
          for (const row of rows) Object.assign(row, payload);
          return { data: rows, error: null };
        }
        if (table === "ordini_testate") {
          const existing = state.ordini_testate.find((row) => row.mexal_chiave === payload.mexal_chiave);
          if (existing) Object.assign(existing, payload);
          else state.ordini_testate.push({ ...payload, id: `order-${nextOrder++}` });
          const row = state.ordini_testate.find((item) => item.mexal_chiave === payload.mexal_chiave);
          return { data: single ? row : [row], error: null };
        }
        if (table === "ordini_righe") {
          for (const incoming of payload) {
            const existing = state.ordini_righe.find((row) => row.ordine_id === incoming.ordine_id && row.mexal_posizione === incoming.mexal_posizione);
            if (existing) Object.assign(existing, incoming);
            else state.ordini_righe.push({ ...incoming, id: `line-${state.ordini_righe.length + 1}` });
          }
          return { data: payload, error: null };
        }
        throw new Error(`Upsert inatteso su ${table}`);
      }
      return query;
    },
  };
}

function mixedImportMexal() {
  const document = {
    sigla: "OC", cod_modulo: "T", serie: 2, numero: 500, cod_conto: "C1",
    righe: [
      { id_riga: 1, tp_riga: "R", codice_articolo: "PB0004", quantita: 2, tp_um_articolo: "1" },
      { id_riga: 2, tp_riga: "R", codice_articolo: "IT0064", quantita: 3 },
      { id_riga: 3, tp_riga: "D", descr_riga: "Nota auditabile" },
    ],
  };
  return {
    async getJson(path) {
      if (path === "/oct?max=200") return { dati: [{ sigla: "OC", serie: 2, numero: 500 }] };
      if (path === "/documenti/ordini-clienti/OC%2B2%2B500") return document;
      throw new Error(`Percorso inatteso: ${path}`);
    },
  };
}

test("import misto conserva record validi e descrittivi, telemetra l'anomalo e non viola FK", async () => {
  const supabase = writableSupabase();
  const result = await syncOctOrders({
    mexal: mixedImportMexal(), supabase,
    env: { MEXAL_OCT_IMPORT_ENABLED: "true", MEXAL_OCT_MODULE_CODE: "T", MEXAL_OCT_LIST_PATH: "/oct" },
    context: { cycle_id: 152, job_id: 1411 },
  });
  assert.equal(result.completed, true);
  assert.equal(result.status, "completed");
  assert.equal(result.imported, 1);
  assert.equal(result.imported_lines, 2);
  assert.equal(result.skipped_article_lines, 1);
  assert.equal(result.anomaly_count, 1);
  assert.equal(result.anomalies[0].article_code, "IT0064");
  assert.deepEqual(supabase.state.ordini_righe.map((row) => row.codice_articolo), ["PB0004", null]);
  assert.equal(supabase.state.ordini_righe[0].unita_misura_oct, "PZ");
  assert.ok(supabase.state.ordini_righe.every((row) => row.riga_descrittiva || row.codice_articolo === "PB0004"));
});

test("retry dello stesso OCT è idempotente e non crea duplicati", async () => {
  const supabase = writableSupabase();
  const input = {
    mexal: mixedImportMexal(), supabase,
    env: { MEXAL_OCT_IMPORT_ENABLED: "true", MEXAL_OCT_MODULE_CODE: "T", MEXAL_OCT_LIST_PATH: "/oct" },
  };
  await syncOctOrders(input);
  await syncOctOrders(input);
  assert.equal(supabase.state.ordini_testate.length, 1);
  assert.equal(supabase.state.ordini_righe.length, 2);
});

test("un OCT creato da OrdiniPrivate aggiorna la testata sorgente senza duplicarla", async () => {
  const supabase = writableSupabase();
  supabase.state.ordini_testate.push({ id: "private-order-1", modulo_ordini: "private", origine: "workspace", codice_cliente: "C1" });
  supabase.state.ordini_documenti_mexal.push({ ordine_id: "private-order-1", tipo_documento: "OCT", modulo: "ORDINIPRIVATE", sigla: "OC", serie: 2, numero: "500" });

  await syncOctOrders({
    mexal: mixedImportMexal(), supabase,
    env: { MEXAL_OCT_IMPORT_ENABLED: "true", MEXAL_OCT_MODULE_CODE: "T", MEXAL_OCT_LIST_PATH: "/oct" },
  });

  assert.equal(supabase.state.ordini_testate.length, 1);
  assert.equal(supabase.state.ordini_testate[0].id, "private-order-1");
  assert.equal(supabase.state.ordini_testate[0].modulo_ordini, "private");
  assert.equal(supabase.state.ordini_testate[0].origine, "mexal_oct");
  assert.equal(supabase.state.ordini_testate[0].mexal_chiave, "OC+2+500");
});

test("una riga rimossa da Mexal viene ritirata logicamente senza perdere lineage", async () => {
  const supabase = writableSupabase();
  const document = {
    sigla: "OC", cod_modulo: "T", serie: 2, numero: 206, cod_conto: "C1",
    righe: [
      { id_riga: 1, tp_riga: "R", codice_articolo: "PB0004", quantita: 3000, tp_um_articolo: "1" },
      { id_riga: 2, tp_riga: "R", codice_articolo: "PB0004", quantita: 3000, tp_um_articolo: "1" },
    ],
  };
  const mexal = {
    async getJson(path) {
      if (path === "/oct?max=200") return { dati: [{ sigla: "OC", serie: 2, numero: 206 }] };
      if (path === "/documenti/ordini-clienti/OC%2B2%2B206") return document;
      throw new Error(`Percorso inatteso: ${path}`);
    },
  };
  const input = {
    mexal, supabase,
    env: { MEXAL_OCT_IMPORT_ENABLED: "true", MEXAL_OCT_MODULE_CODE: "T", MEXAL_OCT_LIST_PATH: "/oct" },
  };
  await syncOctOrders(input);
  document.righe = [document.righe[0]];
  const result = await syncOctOrders(input);

  assert.equal(supabase.state.ordini_righe.length, 2);
  assert.equal(supabase.state.ordini_righe[0].mexal_attiva, true);
  assert.equal(supabase.state.ordini_righe[0].mexal_ritirata_il, null);
  assert.equal(supabase.state.ordini_righe[1].mexal_attiva, false);
  assert.match(supabase.state.ordini_righe[1].mexal_ritirata_il, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.retired_lines, 1);
});

test("un documento temporaneamente illeggibile non blocca gli OCT validi e non espone l'utente Mexal", async () => {
  const supabase = writableSupabase();
  const valid = mixedImportMexal();
  const mexal = {
    async getJson(path) {
      if (path === "/oct?max=200") return { dati: [{ sigla: "OC", serie: 2, numero: 417 }, { sigla: "OC", serie: 2, numero: 500 }] };
      if (path === "/documenti/ordini-clienti/OC%2B2%2B417") throw new Error("Documento in uso dall'utente MARIO sul terminale 14");
      return valid.getJson(path);
    },
  };
  const result = await syncOctOrders({
    mexal, supabase,
    env: { MEXAL_OCT_IMPORT_ENABLED: "true", MEXAL_OCT_MODULE_CODE: "T", MEXAL_OCT_LIST_PATH: "/oct" },
  });
  assert.equal(result.completed, true);
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 1);
  const readFailure = result.anomalies.find((item) => item.error_code === "OCT_DOCUMENT_READ_FAILED");
  assert.equal(readFailure.oct, "OC+2+417");
  assert.match(readFailure.message, /utente \[redacted\]/i);
  assert.doesNotMatch(readFailure.message, /MARIO/);
});

test("handler propaga cycle_id e job_id nella telemetria del job", async () => {
  const supabase = writableSupabase();
  const handler = createOctOrdersRunHandler({
    createMexalClient: mixedImportMexal,
    createSupabaseClient: () => supabase,
    env: { MEXAL_OCT_IMPORT_ENABLED: "true", MEXAL_OCT_MODULE_CODE: "T", MEXAL_OCT_LIST_PATH: "/oct" },
  });
  let response;
  await handler({ body: { context: { cycle_id: 153, job_id: 1422 } } }, { status: () => ({ json: (value) => { response = value; return value; } }) });
  assert.equal(response.cycle_id, 153);
  assert.equal(response.job_id, 1422);
  assert.equal(response.anomalies[0].cycle_id, 153);
  assert.equal(response.anomalies[0].job_id, 1422);
});

function summary(numero) {
  return { sigla: "OC", serie: 2, numero };
}

test("paginator legge una pagina senza next", async () => {
  const paths = [];
  const result = await readMexalCollectionPages({
    mexal: { getJson: async (path) => { paths.push(path); return { dati: [summary(1)] }; } },
    path: "/documenti/ordini-clienti",
  });

  assert.deepEqual(paths, ["/documenti/ordini-clienti?max=200"]);
  assert.deepEqual(result.records, [summary(1)]);
  assert.deepEqual(
    { pagesRead: result.pagesRead, recordsRead: result.recordsRead, duplicatesSkipped: result.duplicatesSkipped },
    { pagesRead: 1, recordsRead: 1, duplicatesSkipped: 0 },
  );
});

test("paginator segue next, conserva l'ordine e deduplica i documenti", async () => {
  const pages = new Map([
    ["/documenti/ordini-clienti?max=200", { dati: [summary(1), summary(2)], next: "pagina 2" }],
    ["/documenti/ordini-clienti?max=200&next=pagina+2", { dati: [summary(2), summary(3)] }],
  ]);
  const paths = [];
  const result = await readMexalCollectionPages({
    mexal: { getJson: async (path) => { paths.push(path); return pages.get(path); } },
    path: "/documenti/ordini-clienti",
  });

  assert.deepEqual(paths, [...pages.keys()]);
  assert.deepEqual(result.records.map((record) => record.numero), [1, 2, 3]);
  assert.equal(result.pagesRead, 2);
  assert.equal(result.recordsRead, 4);
  assert.equal(result.duplicatesSkipped, 1);
});

test("paginator considera next vuoto o whitespace come fine collection", async () => {
  for (const next of ["", "   "]) {
    let calls = 0;
    const result = await readMexalCollectionPages({
      mexal: { getJson: async () => { calls += 1; return { dati: [summary(1)], next }; } },
      path: "/documenti/ordini-clienti",
    });
    assert.equal(calls, 1);
    assert.equal(result.pagesRead, 1);
  }
});

test("paginator interrompe un token next ripetuto con errore controllato", async () => {
  let calls = 0;
  await assert.rejects(
    readMexalCollectionPages({
      mexal: { getJson: async () => { calls += 1; return { dati: [summary(calls)], next: "stesso-token" }; } },
      path: "/documenti/ordini-clienti",
    }),
    /token next ripetuto/i,
  );
  assert.equal(calls, 2);
});

test("paginator legge oltre 1000 documenti su più pagine", async () => {
  const allRecords = Array.from({ length: 1205 }, (_, index) => summary(index + 1));
  const requestedMax = [];
  const result = await readMexalCollectionPages({
    mexal: {
      async getJson(path) {
        const url = new URL(path, "https://mexal.test");
        const max = Number(url.searchParams.get("max"));
        const offset = Number(url.searchParams.get("next") || 0);
        requestedMax.push(max);
        const end = Math.min(offset + max, allRecords.length);
        return { dati: allRecords.slice(offset, end), next: end < allRecords.length ? String(end) : "" };
      },
    },
    path: "/documenti/ordini-clienti",
  });

  assert.equal(result.records.length, 1205);
  assert.equal(result.recordsRead, 1205);
  assert.equal(result.pagesRead, 7);
  assert.ok(requestedMax.every((max) => max === 200));
  assert.deepEqual([result.records[0].numero, result.records.at(-1).numero], [1, 1205]);
});

test("precheck e import usano lo stesso paginator multi-pagina", async () => {
  async function execute(operation) {
    const paths = [];
    const mexal = {
      async getJson(path) {
        paths.push(path);
        if (path === "/documenti/ordini-clienti?max=200") return { dati: [{ sigla: "XX", serie: 1, numero: 1 }], next: "due" };
        if (path === "/documenti/ordini-clienti?max=200&next=due") return { dati: [{ sigla: "XX", serie: 1, numero: 2 }] };
        throw new Error(`Percorso inatteso: ${path}`);
      },
    };
    const env = { MEXAL_OCT_IMPORT_ENABLED: "true", MEXAL_OCT_MODULE_CODE: "T", MEXAL_OCT_LIST_PATH: "/documenti/ordini-clienti" };
    const result = operation === "precheck"
      ? await precheckOctOrders({ mexal, supabase: {}, env })
      : await syncOctOrders({ mexal, supabase: {}, env });
    return { paths, result };
  }

  const precheck = await execute("precheck");
  const imported = await execute("import");

  assert.deepEqual(imported.paths, precheck.paths);
  assert.equal(precheck.result.source_pages, 2);
  assert.equal(precheck.result.source_records_read, 2);
  assert.equal(imported.result.pages_read, 2);
  assert.equal(imported.result.records_read, 2);
});

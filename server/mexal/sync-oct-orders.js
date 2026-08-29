import process from "node:process";
import { authoritativeArticleUnit, resolveOctUnitOfMeasure } from "./unit-of-measure.js";
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function first(object, names) { for (const name of names) if (object?.[name] !== undefined) return object[name]; return null; }
function matrixFirst(value) {
  return Array.isArray(value) && Array.isArray(value[0]) ? value[0][value[0].length - 1] : value;
}
function matrixMap(value) {
  const result = new Map();
  if (!Array.isArray(value)) return result;
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const rawPosition = entry[0];
    const numericPosition = number(rawPosition);
    result.set(numericPosition ?? rawPosition, entry[entry.length - 1]);
  }
  return result;
}
function parallelRowsOf(document) {
  const fields = {
    id_riga: matrixMap(document?.id_riga),
    tp_riga: matrixMap(document?.tp_riga),
    codice_articolo: matrixMap(first(document, ["codice_articolo", "cod_articolo", "articolo"])),
    descr_riga: matrixMap(first(document, ["descr_riga", "descr_articolo", "descrizione"])),
    quantita: matrixMap(first(document, ["quantita", "qta"])),
    unita_misura: matrixMap(first(document, ["unita_misura", "um", "sigla_um"])),
    tp_um_articolo: matrixMap(first(document, ["tp_um_articolo", "tipo_unita_misura"])),
    dt_sca_riga: matrixMap(first(document, ["dt_sca_riga", "data_consegna_riga", "data_scadenza_riga"])),
  };
  const positions = [...new Set(Object.values(fields).flatMap((values) => [...values.keys()]))];
  return positions
    .sort((left, right) => {
      if (typeof left === "number" && typeof right === "number") return left - right;
      return String(left).localeCompare(String(right));
    })
    .map((position) => Object.fromEntries([
      ["_matrix_position", position],
      ...Object.entries(fields).map(([name, values]) => [name, values.get(position)]),
    ]));
}
function rowsOf(document) {
  for (const value of [document?.righe, document?.dati?.righe, document?.documento?.righe]) if (Array.isArray(value)) return value;
  return parallelRowsOf(document);
}
function documentsOf(payload) {
  if (Array.isArray(payload)) return payload;
  for (const value of [payload?.data, payload?.dati, payload?.items, payload?.documenti]) if (Array.isArray(value)) return value;
  return [];
}

const DEFAULT_COLLECTION_PAGE_SIZE = 200;
const MAX_COLLECTION_PAGE_SIZE = 1000;

function collectionPageSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_COLLECTION_PAGE_SIZE;
  return Math.min(MAX_COLLECTION_PAGE_SIZE, Math.max(1, Math.trunc(parsed)));
}

function collectionPagePath(path, { pageSize, next }) {
  const [resource, query = ""] = text(path).split("?", 2);
  const params = new URLSearchParams(query);
  params.set("max", String(collectionPageSize(pageSize)));
  if (text(next)) params.set("next", text(next));
  else params.delete("next");
  return `${resource}?${params.toString()}`;
}

function defaultCollectionKey(record) {
  const identity = summaryIdentity(record);
  return identity?.reference || JSON.stringify(record);
}

export async function readMexalCollectionPages({
  mexal,
  path,
  pageSize = DEFAULT_COLLECTION_PAGE_SIZE,
  keyOf = defaultCollectionKey,
}) {
  if (!mexal?.getJson || !text(path)) throw new TypeError("Configurazione collection Mexal non valida.");
  const records = [];
  const seenRecords = new Set();
  const seenNextTokens = new Set();
  let next = null;
  let pagesRead = 0;
  let recordsRead = 0;
  let duplicatesSkipped = 0;

  do {
    const payload = await mexal.getJson(collectionPagePath(path, { pageSize, next }));
    const pageRecords = documentsOf(payload);
    pagesRead += 1;
    recordsRead += pageRecords.length;

    for (const record of pageRecords) {
      const key = keyOf(record);
      if (seenRecords.has(key)) {
        duplicatesSkipped += 1;
        continue;
      }
      seenRecords.add(key);
      records.push(record);
    }

    const returnedNext = text(payload?.next);
    if (!returnedNext) {
      next = null;
      continue;
    }
    if (seenNextTokens.has(returnedNext)) {
      throw new Error("Paginazione Mexal non valida: token next ripetuto.");
    }
    seenNextTokens.add(returnedNext);
    next = returnedNext;
  } while (next !== null);

  return { records, pagesRead, recordsRead, duplicatesSkipped };
}

function sourceConfig(env) {
  const moduleCode = text(env.MEXAL_OCT_MODULE_CODE);
  const listPath = text(env.MEXAL_OCT_LIST_PATH);
  if (!moduleCode || !listPath) throw new Error("Configurazione importer OCT incompleta.");
  return { moduleCode, listPath };
}

function summaryIdentity(summary) {
  const sigla = upper(first(summary, ["sigla", "sigla_documento"]));
  const serie = number(first(summary, ["serie"]));
  const numero = number(first(summary, ["numero"]));
  if (sigla !== "OC" || !Number.isInteger(serie) || !Number.isInteger(numero)) return null;
  return { sigla, serie, numero, reference: [sigla, serie, numero].join("+") };
}

async function readOctSummary({ mexal, summary, moduleCode }) {
  const identity = summaryIdentity(summary);
  if (!identity) return { status: "skipped", reason: "Identità documento non valida o sigla diversa da OC." };
  const detailPath = "/documenti/ordini-clienti/" + encodeURIComponent(identity.reference);
  const detail = await mexal.getJson(detailPath);
  if (!isOctDocument(detail, { moduleCode })) {
    return { status: "skipped", reason: "Documento fuori dal modulo OCT configurato.", identity };
  }
  return { status: "candidate", identity, normalized: normalizeOct(detail) };
}

function chunks(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function selectInChunks({ supabase, table, columns, column, values, configure = (query) => query }) {
  const rows = [];
  for (const batch of chunks(values)) {
    const { data, error } = await configure(supabase.from(table).select(columns)).in(column, batch);
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

function groupedDuplicates(rows, keyOf, shape) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const values = grouped.get(key) || [];
    values.push(row);
    grouped.set(key, values);
  }
  return [...grouped.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([key, values]) => shape(key, values));
}

function orderArticleCodes(documents) {
  return [...new Set(documents.flatMap((document) => document.lines)
    .filter((line) => !line.riga_descrittiva && text(line.codice_articolo))
    .map((line) => text(line.codice_articolo)))];
}

async function readAvailableOrderArticleCatalog(supabase, documents) {
  const articleCodes = orderArticleCodes(documents);
  if (!articleCodes.length) return new Map();
  const rows = await selectInChunks({
    supabase,
    table: "ordini_prodotti_cache",
    columns: "codice_articolo,unita_misura,dati_mexal",
    column: "codice_articolo",
    values: articleCodes,
  });
  return new Map(rows.map((row) => [text(row.codice_articolo), row]).filter(([code]) => code));
}

function resolveDocumentUnits(document, catalog) {
  return {
    ...document,
    lines: document.lines.map((line) => {
      if (line.riga_descrittiva || line.unita_misura_oct) return line;
      const article = catalog.get(text(line.codice_articolo));
      const primaryUnit = authoritativeArticleUnit(article) || authoritativeArticleUnit(article?.dati_mexal);
      const resolved = resolveOctUnitOfMeasure({
        explicitUnit: line.unita_misura_oct,
        mexalUnitType: line.tipo_unita_misura_mexal,
        article: { unita_misura: primaryUnit },
      });
      return { ...line, unita_misura_oct: resolved.unit };
    }),
  };
}

function anomalyContext(context = {}) {
  return {
    cycle_id: number(context.cycle_id),
    job_id: number(context.job_id),
  };
}

function safeOperationalError(error) {
  return text(error?.message || error)
    .replace(/utente\s+[^\s\]]+/giu, "utente [redacted]")
    .slice(0, 500);
}

export function classifyOctLines(document, availableArticleCodes, { context = {}, timestamp = new Date().toISOString() } = {}) {
  const available = availableArticleCodes instanceof Set
    ? availableArticleCodes
    : new Set((availableArticleCodes || []).map((value) => text(value)).filter(Boolean));
  const valid = [];
  const anomalies = [];
  for (const line of document.lines || []) {
    const code = text(line.codice_articolo);
    if (line.riga_descrittiva || (code && available.has(code))) {
      valid.push(line);
      continue;
    }
    if (!code) {
      anomalies.push({
        ...anomalyContext(context),
        oct: document.key,
        oct_line: line.mexal_posizione,
        article_code: null,
        line_type: line.mexal_tipo_riga,
        error_code: "OCT_ARTICLE_CODE_EMPTY",
        message: "Riga articolo OCT priva di codice articolo.",
        timestamp,
      });
      continue;
    }
    anomalies.push({
      ...anomalyContext(context),
      oct: document.key,
      oct_line: line.mexal_posizione,
      article_code: code,
      line_type: line.mexal_tipo_riga,
      error_code: "OCT_ARTICLE_NOT_IN_ORDER_CACHE",
      message: "Articolo OCT non presente nell'anagrafica ordini sincronizzata.",
      timestamp,
    });
  }
  return { valid, anomalies };
}

export function isOctDocument(document, { moduleCode }) {
  const expected = upper(moduleCode);
  if (!expected) throw new Error("MEXAL_OCT_MODULE_CODE deve essere configurato esplicitamente.");
  const sigla = upper(first(document, ["sigla", "sigla_documento"]));
  const module = upper(first(document, ["cod_modulo", "modulo"]));
  return sigla === "OC" && module === expected && !["M", "X", "I"].includes(module);
}

export function normalizeOct(document) {
  const sigla = upper(first(document, ["sigla", "sigla_documento"]));
  const codModulo = upper(first(document, ["cod_modulo", "modulo"]));
  const serie = number(first(document, ["serie"]));
  const numero = number(first(document, ["numero"]));
  if (!sigla || !Number.isInteger(serie) || !Number.isInteger(numero)) throw new Error("Identità documento OCT incompleta.");
  const key = `${sigla}+${serie}+${numero}`;
  const lines = rowsOf(document).map((line, index) => {
    const code = text(first(line, ["codice_articolo", "cod_articolo", "codice", "articolo"]));
    return {
      mexal_posizione: number(first(line, ["id_riga", "posizione", "indice_riga", "riga", "_matrix_position"])) ?? index + 1,
      codice_articolo: code || null,
      descrizione: text(first(line, ["descr_articolo", "descr_riga", "descrizione"])),
      quantita: number(first(line, ["quantita", "qta"])) ?? 0,
      unita_misura_oct: upper(first(line, ["unita_misura", "um", "sigla_um"])) || null,
      tipo_unita_misura_mexal: text(first(line, ["tp_um_articolo", "tipo_unita_misura"])) || null,
      data_consegna: matrixFirst(first(line, ["dt_sca_riga", "data_consegna_riga", "data_scadenza_riga", "data_consegna", "data_scadenza"])),
      mexal_tipo_riga: text(first(line, ["tp_riga", "tipo_riga", "tipo"])) || null,
      riga_descrittiva: !code,
    };
  });
  const headerDeliveryDate = matrixFirst(first(document, ["data_consegna", "data_scadenza", "dt_sca", "dt_consegna"]));
  const lineDeliveryDates = lines.filter((line) => !line.riga_descrittiva && line.data_consegna).map((line) => line.data_consegna).sort();
  return {
    key,
    header: {
      origine: "mexal_oct", modulo_ordini: "private", mexal_sigla: sigla, mexal_cod_modulo: codModulo,
      mexal_serie: serie, mexal_numero: numero, mexal_anno: number(first(document, ["anno"])),
      mexal_chiave: key, mexal_cod_conto: text(first(document, ["cod_conto", "codice_cliente"])),
      codice_cliente: text(first(document, ["cod_conto", "codice_cliente"])),
      data_ordine: matrixFirst(first(document, ["data_documento", "data"])),
      data_consegna: headerDeliveryDate || lineDeliveryDates[0] || null,
      mexal_sincronizzato_il: new Date().toISOString(), stato_sincronizzazione: "importato_mexal",
    },
    lines,
  };
}

export async function precheckOctOrders({ mexal, supabase, env = process.env }) {
  if (!mexal || !supabase) throw new TypeError("Dipendenze precheck OCT non valide.");
  const { moduleCode, listPath } = sourceConfig(env);
  const collection = await readMexalCollectionPages({
    mexal,
    path: listPath,
    pageSize: env.MEXAL_OCT_PAGE_SIZE,
  });
  const summaries = collection.records;
  const documents = [];
  const parsingErrors = [];
  let skipped = 0;
  let candidateCount = 0;

  for (let index = 0; index < summaries.length; index += 1) {
    const summary = summaries[index];
    try {
      const read = await readOctSummary({ mexal, summary, moduleCode });
      if (read.status !== "candidate") {
        skipped += 1;
        continue;
      }
      candidateCount += 1;
      documents.push(read.normalized);
    } catch (error) {
      const identity = summaryIdentity(summary);
      parsingErrors.push({
        summary_index: index,
        reference: identity?.reference || null,
        stage: identity ? "detail_or_normalization" : "summary_identity",
        message: error?.message || String(error),
      });
    }
  }

  const sourceHeaderDuplicates = groupedDuplicates(
    documents,
    (document) => document.key,
    (key, values) => ({ scope: "mexal_source", key, occurrences: values.length }),
  );
  const sourceLineDuplicates = documents.flatMap((document) => groupedDuplicates(
    document.lines,
    (line) => `${document.key}:${line.mexal_posizione}`,
    (_key, values) => ({
      scope: "mexal_source",
      key: document.key,
      serie: document.header.mexal_serie,
      numero: document.header.mexal_numero,
      mexal_posizione: values[0].mexal_posizione,
      occurrences: values.length,
    }),
  ));

  const articleCodes = orderArticleCodes(documents).map(upper);
  const documentKeys = [...new Set(documents.map((document) => document.key))];

  const productRows = articleCodes.length ? await selectInChunks({
    supabase,
    table: "prodotti",
    columns: "id,codice_mexal,attivo_mexal,mostra_in_app,linea_mexal,sincronizzato_mexal",
    column: "codice_mexal",
    values: articleCodes,
  }) : [];
  const availableOrderArticleCatalog = await readAvailableOrderArticleCatalog(supabase, documents);
  for (let index = 0; index < documents.length; index += 1)
    documents[index] = resolveDocumentUnits(documents[index], availableOrderArticleCatalog);
  const availableOrderArticleCodes = new Set(availableOrderArticleCatalog.keys());
  const productsByCode = new Map();
  for (const product of productRows) {
    const code = upper(product.codice_mexal);
    const values = productsByCode.get(code) || [];
    values.push(product);
    productsByCode.set(code, values);
  }

  const existingHeaders = documentKeys.length ? await selectInChunks({
    supabase,
    table: "ordini_testate",
    columns: "id,mexal_sigla,mexal_serie,mexal_numero,mexal_chiave",
    column: "mexal_chiave",
    values: documentKeys,
    configure: (query) => query.eq("origine", "mexal_oct"),
  }) : [];
  const headerIds = existingHeaders.map((header) => header.id).filter(Boolean);
  const existingLines = headerIds.length ? await selectInChunks({
    supabase,
    table: "ordini_righe",
    columns: "id,ordine_id,mexal_posizione",
    column: "ordine_id",
    values: headerIds,
  }) : [];
  const headersByKey = new Map();
  for (const header of existingHeaders) {
    const key = text(header.mexal_chiave) || [upper(header.mexal_sigla), number(header.mexal_serie), number(header.mexal_numero)].join("+");
    const values = headersByKey.get(key) || [];
    values.push(header);
    headersByKey.set(key, values);
  }

  const presentArticleCodes = articleCodes.filter((code) => availableOrderArticleCodes.has(code));
  const missingArticleCodes = articleCodes.filter((code) => !availableOrderArticleCodes.has(code));
  const inactiveArticles = articleCodes.flatMap((code) => (productsByCode.get(code) || [])
    .filter((product) => product.attivo_mexal !== true || product.mostra_in_app === false || product.sincronizzato_mexal === false)
    .map((product) => ({ code, product_id: product.id, attivo_mexal: product.attivo_mexal, mostra_in_app: product.mostra_in_app, sincronizzato_mexal: product.sincronizzato_mexal })));
  const outOfProductionArticles = presentArticleCodes.flatMap((code) => productsByCode.get(code)
    .filter((product) => /fuori\s+produzione/i.test(text(product.linea_mexal)))
    .map((product) => ({ code, product_id: product.id, linea_mexal: product.linea_mexal })));
  const workspaceProductDuplicates = groupedDuplicates(
    productRows,
    (product) => upper(product.codice_mexal),
    (code, values) => ({ code, product_ids: values.map((product) => product.id), occurrences: values.length }),
  );
  const workspaceHeaderDuplicates = groupedDuplicates(
    existingHeaders,
    (header) => text(header.mexal_chiave) || [upper(header.mexal_sigla), number(header.mexal_serie), number(header.mexal_numero)].join("+"),
    (key, values) => ({ scope: "workspace", key, order_ids: values.map((header) => header.id), occurrences: values.length }),
  );
  const workspaceLineDuplicates = groupedDuplicates(
    existingLines,
    (line) => `${line.ordine_id}:${line.mexal_posizione}`,
    (_key, values) => ({ scope: "workspace", order_id: values[0].ordine_id, mexal_posizione: values[0].mexal_posizione, line_ids: values.map((line) => line.id), occurrences: values.length }),
  );

  const reportDocuments = documents.map((document) => {
    const existing = headersByKey.get(document.key) || [];
    return {
      key: document.key,
      sigla: document.header.mexal_sigla,
      modulo: document.header.mexal_cod_modulo,
      serie: document.header.mexal_serie,
      numero: document.header.mexal_numero,
      cliente: document.header.mexal_cod_conto,
      data_ordine: document.header.data_ordine,
      data_consegna: document.header.data_consegna,
      already_in_workspace: existing.length > 0,
      workspace_order_ids: existing.map((header) => header.id),
      lines: document.lines.map((line) => ({
        posizione: line.mexal_posizione,
        tipo: line.mexal_tipo_riga,
        codice_articolo: line.codice_articolo,
        descrizione: line.descrizione,
        quantita: line.quantita,
        unita_misura_oct: line.unita_misura_oct,
        tipo_unita_misura_mexal: line.tipo_unita_misura_mexal,
        dt_sca_riga: line.data_consegna,
        riga_descrittiva: line.riga_descrittiva,
      })),
    };
  });
  const totalLines = reportDocuments.reduce((total, document) => total + document.lines.length, 0);
  const descriptiveLines = reportDocuments.reduce((total, document) => total + document.lines.filter((line) => line.riga_descrittiva).length, 0);
  const articleLines = totalLines - descriptiveLines;
  const alreadyInWorkspace = reportDocuments.filter((document) => document.already_in_workspace);
  const headerDuplicates = [...sourceHeaderDuplicates, ...workspaceHeaderDuplicates];
  const lineDuplicates = [...sourceLineDuplicates, ...workspaceLineDuplicates];

  return {
    dry_run: true,
    read_only: true,
    source_pages: collection.pagesRead,
    source_records_read: collection.recordsRead,
    source_duplicates_skipped: collection.duplicatesSkipped,
    source_documents: summaries.length,
    candidate_oct_count: candidateCount,
    normalized_oct_count: reportDocuments.length,
    skipped_documents: skipped,
    total_rows: totalLines,
    article_rows: articleLines,
    descriptive_rows: descriptiveLines,
    distinct_article_codes_count: articleCodes.length,
    distinct_article_codes: articleCodes,
    workspace_articles_present_count: presentArticleCodes.length,
    workspace_articles_present: presentArticleCodes,
    workspace_articles_missing_count: missingArticleCodes.length,
    workspace_articles_missing: missingArticleCodes,
    inactive_articles: inactiveArticles,
    out_of_production_articles: outOfProductionArticles,
    already_in_workspace_count: alreadyInWorkspace.length,
    already_in_workspace: alreadyInWorkspace.map((document) => ({ key: document.key, serie: document.serie, numero: document.numero, workspace_order_ids: document.workspace_order_ids })),
    header_duplicates: headerDuplicates,
    line_duplicates: lineDuplicates,
    workspace_product_duplicates: workspaceProductDuplicates,
    parsing_errors: parsingErrors,
    documents: reportDocuments,
    has_blocking_anomalies: missingArticleCodes.length > 0 || parsingErrors.length > 0 || headerDuplicates.length > 0 || lineDuplicates.length > 0 || workspaceProductDuplicates.length > 0,
  };
}

export async function syncOctOrders({ mexal, supabase, env = process.env, context = {} }) {
  if (String(env.MEXAL_OCT_IMPORT_ENABLED || "").toLowerCase() !== "true")
    return { enabled: false, imported: 0, skipped: 0 };
  const { moduleCode, listPath } = sourceConfig(env);
  const collection = await readMexalCollectionPages({
    mexal,
    path: listPath,
    pageSize: env.MEXAL_OCT_PAGE_SIZE,
  });
  const summaries = collection.records;
  const documents = [];
  const anomalies = [];
  let imported = 0; let skipped = 0;
  for (const summary of summaries) {
    try {
      const read = await readOctSummary({ mexal, summary, moduleCode });
      if (read.status !== "candidate") { skipped++; continue; }
      documents.push(read.normalized);
    } catch (error) {
      const identity = summaryIdentity(summary);
      anomalies.push({
        ...anomalyContext(context),
        oct: identity?.reference || null,
        oct_line: null,
        article_code: null,
        line_type: null,
        error_code: "OCT_DOCUMENT_READ_FAILED",
        message: safeOperationalError(error),
        timestamp: new Date().toISOString(),
      });
      skipped++;
    }
  }
  const availableArticleCatalog = await readAvailableOrderArticleCatalog(supabase, documents);
  const availableArticleCodes = new Set(availableArticleCatalog.keys());
  let importedLines = 0;
  let skippedArticleLines = 0;
  let retiredLines = 0;
  for (const rawNormalized of documents) {
    const normalized = resolveDocumentUnits(rawNormalized, availableArticleCatalog);
    const { data: customer } = await supabase.from("ordini_clienti_cache").select("codice_cliente,ragione_sociale,codice_agente_mexal").eq("codice_cliente", normalized.header.mexal_cod_conto).maybeSingle();
    normalized.header.cliente_mexal_risolto = Boolean(customer);
    normalized.header.ragione_sociale_cliente = text(customer?.ragione_sociale) || normalized.header.mexal_cod_conto || null;
    normalized.header.codice_agente_mexal = text(customer?.codice_agente_mexal) || null;
    const { data: outboundDocument, error: outboundLookupError } = await supabase
      .from("ordini_documenti_mexal")
      .select("ordine_id")
      .eq("tipo_documento", "OCT")
      .eq("modulo", "ORDINIPRIVATE")
      .eq("sigla", normalized.header.mexal_sigla)
      .eq("serie", normalized.header.mexal_serie)
      .eq("numero", String(normalized.header.mexal_numero))
      .maybeSingle();
    if (outboundLookupError) throw outboundLookupError;
    const orderQuery = outboundDocument?.ordine_id
      ? supabase.from("ordini_testate").update(normalized.header).eq("id", outboundDocument.ordine_id)
      : supabase.from("ordini_testate").upsert(normalized.header, { onConflict: "mexal_sigla,mexal_serie,mexal_numero" });
    const { data: order, error } = await orderQuery.select("id").single();
    if (error) throw error;
    const classified = classifyOctLines(normalized, availableArticleCodes, { context });
    anomalies.push(...classified.anomalies);
    skippedArticleLines += classified.anomalies.length;
    const rows = classified.valid.map((line) => ({
      ...line,
      ordine_id: order.id,
      mexal_attiva: true,
      mexal_ritirata_il: null,
    }));
    if (rows.length) {
      const { error: lineError } = await supabase.from("ordini_righe").upsert(rows, { onConflict: "ordine_id,mexal_posizione" });
      if (lineError) throw lineError;
      importedLines += rows.length;
    }
    const { data: storedLines, error: storedLinesError } = await supabase.from("ordini_righe")
      .select("id,mexal_posizione,mexal_attiva")
      .eq("ordine_id", order.id);
    if (storedLinesError) throw storedLinesError;
    // Only accepted source rows remain eligible for a future RdP. A source row
    // rejected by validation must fail closed instead of reviving stale data.
    const sourcePositions = new Set(rows.map((line) => String(line.mexal_posizione)));
    const staleLineIds = (storedLines || [])
      .filter((line) => line.mexal_attiva !== false && !sourcePositions.has(String(line.mexal_posizione)))
      .map((line) => line.id)
      .filter(Boolean);
    if (staleLineIds.length) {
      const { error: retireError } = await supabase.from("ordini_righe")
        .update({ mexal_attiva: false, mexal_ritirata_il: new Date().toISOString() })
        .in("id", staleLineIds);
      if (retireError) throw retireError;
      retiredLines += staleLineIds.length;
    }
    imported++;
  }
  for (const anomaly of anomalies) console.warn(JSON.stringify({ level: "warn", event: "mexal_oct_import_anomaly", ...anomaly }));
  return {
    enabled: true,
    success: true,
    completed: true,
    status: "completed",
    ...anomalyContext(context),
    processed: imported,
    imported,
    skipped,
    imported_lines: importedLines,
    retired_lines: retiredLines,
    skipped_article_lines: skippedArticleLines,
    anomaly_count: anomalies.length,
    anomalies,
    pages_read: collection.pagesRead,
    records_read: collection.recordsRead,
    unique_records: summaries.length,
    duplicate_records_skipped: collection.duplicatesSkipped,
  };

}
export function createOctOrdersRunHandler({ createMexalClient, createSupabaseClient, env = process.env }) {
  if (typeof createMexalClient !== "function" || typeof createSupabaseClient !== "function")
    throw new TypeError("Dipendenze handler OCT non valide.");
  return async function octOrdersRunHandler(req, res) {
    const enabled = String(env.MEXAL_OCT_IMPORT_ENABLED || "").toLowerCase() === "true";
    const result = await syncOctOrders({
      mexal: enabled ? createMexalClient() : null,
      supabase: enabled ? createSupabaseClient() : null,
      env,
      context: req?.body?.context || {},
    });
    return res.status(200).json(result);
  };
}

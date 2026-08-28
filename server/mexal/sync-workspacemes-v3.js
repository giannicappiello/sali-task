import { payloadHash, classifyComponent, COMPONENT_KIND } from "../workspacemes-v3.js";
import { authoritativeArticleUnit } from "./unit-of-measure.js";

export const PROGREMES_FINISHED_BOM_PREFIXES = Object.freeze(["IT", "DC", "CO", "BT", "DD", "CW", "DR"]);
export const MEXAL_V3_CONTRACT = Object.freeze({
  finishedBom: "/distinte-base/componenti/ricerca",
  supplierOrders: "/documenti/ordini-fornitori",
  supplierOrderLines: "/documenti/ordini-fornitori/righe",
  suppliers: "/fornitori",
  articleUnit: "articoli.um_principale",
  receiptSemantics: "NOT_EXPOSED_BY_MEXAL_ENDPOINT",
});

const clean = (value) => String(value ?? "").trim();
const upper = (value) => clean(value).toUpperCase();
const number = (value) => {
  if (typeof value === "string" && value.includes(",")) value = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const date = (value) => {
  const source = clean(value);
  if (!source) return null;
  const italian = source.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const normalized = italian ? `${italian[3]}-${italian[2]}-${italian[1]}` : source;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};
const dataRows = (payload, endpoint) => {
  if (!Array.isArray(payload?.dati)) throw Object.assign(new Error(`Mexal ${endpoint}: array dati mancante.`), { code: "INVALID_MEXAL_CONTRACT" });
  return payload.dati;
};
const first = (row, keys) => keys.map((key) => row?.[key]).find((value) => value !== null && value !== undefined && clean(value));
const orderKey = (row) => ["sigla", "serie", "numero"].map((key) => clean(row?.[key])).join("/");

async function pagedGet(mexal, endpoint, fields) {
  const rows = [];
  let next = null;
  do {
    const query = new URLSearchParams({ max: "1000", fields });
    if (next) query.set("next", next);
    const payload = await mexal.getJson(`${endpoint}?${query}`);
    rows.push(...dataRows(payload, endpoint));
    next = clean(payload.next) || null;
  } while (next);
  return rows;
}

async function pagedSearch(mexal, endpoint, fields, filter) {
  const rows = [];
  let next = null;
  do {
    const query = new URLSearchParams({ max: "1000", fields });
    if (next) query.set("next", next);
    const payload = await mexal.postJson(`${endpoint}?${query}`, { filtri: [filter] });
    rows.push(...dataRows(payload, endpoint));
    next = clean(payload.next) || null;
  } while (next);
  return rows;
}

function articleUnit(article) {
  return upper(authoritativeArticleUnit(article) || authoritativeArticleUnit(article?.dati_mexal));
}

function certifiedUnit(row, article, context) {
  if (article?.activeMexal === false)
    throw Object.assign(new Error(`Articolo Mexal disattivato per ${context}.`), { code: "MEXAL_ARTICLE_INACTIVE" });
  const primary = articleUnit(article);
  if (!primary) throw Object.assign(new Error(`UDM primaria Mexal mancante per ${context}.`), { code: "MEXAL_PRIMARY_UOM_MISSING" });
  const sourceType = upper(row?.nr_unita_misura);
  if (sourceType && sourceType !== "1" && sourceType !== primary) {
    throw Object.assign(new Error(`UDM distinta ${sourceType} non certificabile rispetto a ${primary} per ${context}.`), {
      code: "MEXAL_BOM_UOM_UNCERTIFIED",
    });
  }
  return { unit: primary, sourceType: sourceType || null };
}

export function normalizeFinishedBomRows(rows, articlesByCode) {
  const grouped = new Map();
  for (const raw of rows || []) {
    const finishedCode = upper(raw.codice);
    const componentCode = upper(raw.codice_mp);
    const quantity = number(raw.qta_utilizzo);
    if (!finishedCode || !componentCode || quantity <= 0) continue;
    const article = articlesByCode.get(componentCode);
    const { unit, sourceType } = certifiedUnit(raw, article, `${finishedCode}/${componentCode}`);
    const classification = classifyComponent({ articleCode: componentCode });
    const key = [componentCode, unit, classification.kind].join("|");
    const values = grouped.get(finishedCode) || new Map();
    const existing = values.get(key);
    values.set(key, {
      sourceLineKey: key,
      articleCode: componentCode,
      description: clean(article?.descrizione) || clean(raw.descrizione) || componentCode,
      quantity: Number(((existing?.quantity || 0) + quantity).toFixed(6)),
      unitOfMeasure: unit,
      sourceUnitType: sourceType,
      componentKind: classification.kind,
      classificationSource: classification.kind === COMPONENT_KIND.FORMULA ? "PROGREMES_MEXAL_FP_RULE" : classification.source,
      formulaExternalRef: classification.kind === COMPONENT_KIND.FORMULA ? componentCode : null,
      metadata: { mexalFields: ["codice", "codice_mp", "qta_utilizzo", "nr_unita_misura"] },
    });
    grouped.set(finishedCode, values);
  }
  return new Map([...grouped].map(([code, values]) => [code, [...values.values()].sort((a, b) => a.sourceLineKey.localeCompare(b.sourceLineKey))]));
}

export function normalizeSupplierOrders({ headers, lines, articlesByCode, suppliersByCode }) {
  const headersByKey = new Map((headers || []).map((row) => [orderKey(row), row]));
  const occurrences = new Map();
  const normalized = [];
  for (const raw of lines || []) {
    const externalOrder = orderKey(raw);
    const header = headersByKey.get(externalOrder);
    const articleCode = upper(raw.codice_articolo);
    const ordered = number(raw.quantita);
    if (!header || !articleCode || ordered <= 0) continue;
    const article = articlesByCode.get(articleCode);
    if (article?.activeMexal === false)
      throw Object.assign(new Error(`Articolo Mexal disattivato per ordine fornitore ${externalOrder}/${articleCode}.`), { code: "MEXAL_ARTICLE_INACTIVE" });
    const unit = articleUnit(article);
    if (!unit) throw Object.assign(new Error(`UDM primaria Mexal mancante per ordine fornitore ${externalOrder}/${articleCode}.`), { code: "MEXAL_PRIMARY_UOM_MISSING" });
    const signature = payloadHash({ externalOrder, articleCode, ordered, expectedAt: clean(raw.dt_sca_riga), description: clean(first(raw, ["descr_articolo", "descr_riga"])) });
    const occurrence = (occurrences.get(signature) || 0) + 1;
    occurrences.set(signature, occurrence);
    const supplierCode = upper(header.cod_conto);
    normalized.push({
      order_external_key: externalOrder,
      line_external_key: `${externalOrder}:${signature}:${occurrence}`,
      supplier_code: supplierCode,
      supplier_name: clean(suppliersByCode.get(supplierCode)?.ragione_sociale) || null,
      article_code: articleCode,
      description: clean(first(raw, ["descr_articolo", "descr_riga"])) || clean(article?.descrizione) || null,
      unit_of_measure: unit,
      ordered_quantity: ordered,
      expected_at: date(raw.dt_sca_riga),
      order_date: date(header.data_documento)?.slice(0, 10) || null,
      source_payload: { header: { sigla: header.sigla, serie: header.serie, numero: header.numero, cod_conto: header.cod_conto, data_documento: header.data_documento }, line: raw },
    });
  }
  return normalized.sort((a, b) => a.line_external_key.localeCompare(b.line_external_key));
}

async function loadArticleMap(supabase) {
  const [cacheResult, activeResult] = await Promise.all([
    supabase.from("ordini_prodotti_cache").select("codice_articolo,descrizione,unita_misura,dati_mexal"),
    supabase.from("prodotti").select("codice_mexal,attivo,attivo_mexal"),
  ]);
  if (cacheResult.error || activeResult.error) throw cacheResult.error || activeResult.error;
  const activeByCode = new Map((activeResult.data || []).map((row) => [upper(row.codice_mexal), row.attivo !== false && row.attivo_mexal !== false]));
  return new Map((cacheResult.data || []).map((row) => [upper(row.codice_articolo), {
    ...row, activeMexal: activeByCode.has(upper(row.codice_articolo)) ? activeByCode.get(upper(row.codice_articolo)) : null,
  }]));
}

export async function syncWorkspaceV3MexalContracts({ mexal, supabase, capturedAt = new Date().toISOString(), finishedArticleCodes = null }) {
  const targetFinishedCodes = new Set((finishedArticleCodes || []).map(upper).filter(Boolean));
  const targeted = targetFinishedCodes.size > 0;
  const articlesByCode = await loadArticleMap(supabase);
  const { data: currentBomRows, error: currentBomError } = await supabase.from("workspace_finished_bom_revisions")
    .select("finished_article_code,unit_of_measure").eq("is_current", true);
  if (currentBomError) throw currentBomError;
  const currentBoms = new Map((currentBomRows || []).map((row) => [upper(row.finished_article_code), row]));
  const bomRows = [];
  const searchPrefixes = targeted ? [...targetFinishedCodes] : PROGREMES_FINISHED_BOM_PREFIXES;
  for (const prefix of searchPrefixes) {
    bomRows.push(...await pagedSearch(mexal, MEXAL_V3_CONTRACT.finishedBom,
      "codice,codice_mp,qta_utilizzo,nr_unita_misura", { campo: "codice", condizione: "inizia_per", valore: prefix }));
  }
  const scopedBomRows = targeted ? bomRows.filter((row) => targetFinishedCodes.has(upper(row.codice))) : bomRows;
  const boms = normalizeFinishedBomRows(scopedBomRows, articlesByCode);
  const bomResults = [];
  for (const [finishedCode, lines] of boms) {
    const finished = articlesByCode.get(finishedCode);
    const finishedUnit = articleUnit(finished);
    if (!finishedUnit) throw Object.assign(new Error(`UDM primaria Mexal mancante per prodotto finito ${finishedCode}.`), { code: "MEXAL_PRIMARY_UOM_MISSING" });
    const canonical = { endpoint: MEXAL_V3_CONTRACT.finishedBom, finishedCode, finishedUnit, baseQuantity: 1, lines };
    const { data, error } = await supabase.rpc("apply_workspace_finished_bom_snapshot", {
      p_finished_article_code: finishedCode,
      p_source_hash: payloadHash(canonical),
      p_unit_of_measure: finishedUnit,
      p_base_quantity: 1,
      p_source_payload: canonical,
      p_lines: lines,
      p_captured_at: capturedAt,
    });
    if (error) throw error;
    bomResults.push({ finishedCode, result: data?.[0] || null });
  }
  for (const [finishedCode, previous] of currentBoms) {
    const inScope = targeted ? targetFinishedCodes.has(finishedCode) : PROGREMES_FINISHED_BOM_PREFIXES.some((prefix) => finishedCode.startsWith(prefix));
    if (boms.has(finishedCode) || !inScope) continue;
    const canonical = { endpoint: MEXAL_V3_CONTRACT.finishedBom, finishedCode, finishedUnit: previous.unit_of_measure,
      baseQuantity: 1, lines: [], tombstone: true };
    const { data, error } = await supabase.rpc("apply_workspace_finished_bom_snapshot", {
      p_finished_article_code: finishedCode, p_source_hash: payloadHash(canonical), p_unit_of_measure: previous.unit_of_measure,
      p_base_quantity: 1, p_source_payload: canonical, p_lines: [], p_captured_at: capturedAt,
    });
    if (error) throw error;
    bomResults.push({ finishedCode, tombstone: true, result: data?.[0] || null });
  }

  const [headers, supplierLines, suppliers] = await Promise.all([
    pagedGet(mexal, MEXAL_V3_CONTRACT.supplierOrders, "sigla,serie,numero,cod_conto,data_documento"),
    pagedGet(mexal, MEXAL_V3_CONTRACT.supplierOrderLines, "sigla,serie,numero,codice_articolo,descr_articolo,descr_riga,quantita,dt_sca_riga"),
    pagedGet(mexal, MEXAL_V3_CONTRACT.suppliers, "codice,ragione_sociale"),
  ]);
  const suppliersByCode = new Map(suppliers.map((row) => [upper(row.codice), row]));
  const relevantComponents = new Set([...boms.values()].flat().map((row) => upper(row.articleCode)));
  const scopedSupplierLines = targeted ? supplierLines.filter((row) => relevantComponents.has(upper(row.codice_articolo))) : supplierLines;
  const normalizedSupplierLines = normalizeSupplierOrders({ headers, lines: scopedSupplierLines, articlesByCode, suppliersByCode });
  const supplierCanonical = { endpoints: [MEXAL_V3_CONTRACT.supplierOrders, MEXAL_V3_CONTRACT.supplierOrderLines], receiptSemantics: MEXAL_V3_CONTRACT.receiptSemantics, lines: normalizedSupplierLines };
  const { data: supplierResult, error: supplierError } = await supabase.rpc("apply_workspace_supplier_order_snapshot", {
    p_snapshot_hash: payloadHash(supplierCanonical),
    p_source_payload: supplierCanonical,
    p_lines: normalizedSupplierLines,
    p_captured_at: capturedAt,
  });
  if (supplierError) throw supplierError;
  return { capturedAt, boms: bomResults, supplierOrders: supplierResult?.[0] || null, contract: MEXAL_V3_CONTRACT };
}

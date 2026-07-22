const CUSTOMER_ENDPOINT = "/dati-generali/categorie-provvigioni";
const ARTICLE_ENDPOINT = "/dati-generali/categorie-provvigioni-articoli";
const MAX_PAGES = 200;

const text = (value) => String(value ?? "").trim();

/** Accept the response envelopes observed across Mexal collection resources. */
export function extractCommissionCategoryRows(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates = [payload?.dati, payload?.records, payload?.items, payload?.data, payload?.risultati, payload?.results, payload?.categorie];
  return candidates.find(Array.isArray) || [];
}

function nextPage(payload) {
  const value = payload?.next ?? payload?.next_token ?? payload?.nextToken ?? payload?.continuation_token ?? payload?.prossimo;
  return text(value) || null;
}

export async function loadCommissionCategories(mexal, endpoint) {
  const rows = [];
  let next = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = next ? `?next=${encodeURIComponent(next)}` : "";
    const payload = await mexal.getJson(`${endpoint}${query}`);
    rows.push(...extractCommissionCategoryRows(payload));
    next = nextPage(payload);
    if (!next) return rows;
  }
  throw new Error("Paginazione categorie provvigionali Mexal interrotta: troppe pagine.");
}

export const loadCustomerCommissionCategories = (mexal) => loadCommissionCategories(mexal, CUSTOMER_ENDPOINT);
export const loadArticleCommissionCategories = (mexal) => loadCommissionCategories(mexal, ARTICLE_ENDPOINT);

function firstPresent(record, keys) {
  for (const key of keys) if (record?.[key] !== undefined && record?.[key] !== null && text(record[key])) return record[key];
  return null;
}

/**
 * The official endpoint payload supplies code/description fields.  Keep their
 * original values in payload and only map stable, semantic variants here.
 */
export function normalizeCommissionCategory(record, tipo, synchronizedAt = new Date().toISOString()) {
  const codice = firstPresent(record, ["codice", "id", "id_categoria", "cod_cat_pr", "id_categoria_pr"]);
  if (!text(codice)) throw new Error("Categoria provvigionale Mexal priva di codice.");
  const attivoValue = firstPresent(record, ["attivo", "attiva", "abilitato"]);
  const attivo = typeof attivoValue === "boolean" ? attivoValue : /^(s|si|y|yes|true|1)$/i.test(text(attivoValue)) ? true : /^(n|no|false|0)$/i.test(text(attivoValue)) ? false : null;
  return {
    tipo,
    codice_mexal: text(codice),
    identificativo_mexal: text(firstPresent(record, ["id", "id_categoria"])) || null,
    descrizione: text(firstPresent(record, ["descrizione", "description", "nome"])) || null,
    attivo,
    payload: record,
    sincronizzato_il: synchronizedAt,
    updated_at: synchronizedAt,
  };
}

function comparable(category) {
  return JSON.stringify({ descrizione: category.descrizione, identificativo_mexal: category.identificativo_mexal, attivo: category.attivo, payload: category.payload });
}

export async function upsertCommissionCategories(supabase, categories) {
  const summary = { inserted: 0, updated: 0, unchanged: 0, errors: [] };
  for (const category of categories) {
    try {
      const { data: existing, error: readError } = await supabase.from("mexal_categorie_provvigionali").select("descrizione,identificativo_mexal,attivo,payload").eq("tipo", category.tipo).eq("codice_mexal", category.codice_mexal).maybeSingle();
      if (readError) throw readError;
      if (existing && comparable(existing) === comparable(category)) {
        summary.unchanged += 1;
        // A successful read is still a successful synchronization timestamp.
        const { error } = await supabase.from("mexal_categorie_provvigionali").update({ sincronizzato_il: category.sincronizzato_il, updated_at: category.updated_at }).eq("tipo", category.tipo).eq("codice_mexal", category.codice_mexal);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("mexal_categorie_provvigionali").upsert(category, { onConflict: "tipo,codice_mexal" });
        if (error) throw error;
        if (existing) summary.updated += 1;
        else summary.inserted += 1;
      }
    } catch (error) { summary.errors.push({ tipo: category.tipo, codice_mexal: category.codice_mexal, message: String(error?.message || error).slice(0, 300) }); }
  }
  return summary;
}

export async function syncCommissionCategories({ mexal, supabase, now = () => new Date().toISOString() }) {
  const summary = { readOnly: true, letti_da_mexal: 0, inseriti: 0, aggiornati: 0, invariati: 0, errori: [], categorie_clienti: 0, categorie_articoli: 0 };
  const [customerRows, articleRows] = await Promise.all([loadCustomerCommissionCategories(mexal), loadArticleCommissionCategories(mexal)]);
  summary.categorie_clienti = customerRows.length; summary.categorie_articoli = articleRows.length; summary.letti_da_mexal = customerRows.length + articleRows.length;
  const normalized = [];
  for (const [tipo, rows] of [["cliente", customerRows], ["articolo", articleRows]]) for (const row of rows) {
    try { normalized.push(normalizeCommissionCategory(row, tipo, now())); }
    catch (error) { summary.errori.push({ tipo, message: String(error?.message || error).slice(0, 300) }); }
  }
  const writes = await upsertCommissionCategories(supabase, normalized);
  summary.inseriti = writes.inserted; summary.aggiornati = writes.updated; summary.invariati = writes.unchanged; summary.errori.push(...writes.errors);
  return summary;
}

export { ARTICLE_ENDPOINT, CUSTOMER_ENDPOINT };

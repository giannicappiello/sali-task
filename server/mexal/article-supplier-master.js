const clean = (value) => String(value ?? "").trim();

function supplierEntry(value, fallbackPosition) {
  if (Array.isArray(value)) {
    return { position: Number(value[0]) || fallbackPosition, supplierCode: clean(value[1]) };
  }
  if (value && typeof value === "object") {
    return {
      position: Number(value.position ?? value.posizione ?? value.priority ?? value.priorita) || fallbackPosition,
      supplierCode: clean(value.supplierCode ?? value.codiceFornitore ?? value.cod_fornitore ?? value.codice ?? value.code),
    };
  }
  return { position: fallbackPosition, supplierCode: clean(value) };
}

/**
 * Mexal espone il menu Fornitori dell'anagrafica articolo come coppie
 * [posizione, codice conto]. La posizione conserva l'ordine configurato
 * nell'anagrafica, mentre il codice conto identifica il fornitore.
 */
export function extractArticleMasterSuppliers(article = {}) {
  const raw = article.cod_fornitore ?? article.codFornitore ?? article.suppliers ?? [];
  const values = Array.isArray(raw) ? raw : Object.values(raw || {});
  const byCode = new Map();
  values.forEach((value, index) => {
    const entry = supplierEntry(value, index + 1);
    const key = entry.supplierCode.toUpperCase();
    if (!key) return;
    const current = byCode.get(key);
    if (!current || entry.position < current.position) byCode.set(key, entry);
  });
  return [...byCode.values()].sort((left, right) => left.position - right.position ||
    left.supplierCode.localeCompare(right.supplierCode));
}

export async function readMexalArticleSupplierMaster(mexal, options = {}) {
  const pageSize = Math.min(500, Math.max(1, Number(options.pageSize) || 500));
  const maxPages = Math.min(1_000, Math.max(1, Number(options.maxPages) || 200));
  const relationships = [];
  let next = null;
  let page = 0;
  do {
    if (page >= maxPages) {
      throw Object.assign(new Error("Paginazione anagrafica articoli Mexal interrotta: troppe pagine."), {
        code: "MEXAL_ARTICLE_SUPPLIER_MASTER_PAGE_LIMIT",
      });
    }
    const params = new URLSearchParams({
      max: String(pageSize),
      fields: "codice,cod_fornitore,gest_annullato,gest_precanc",
    });
    if (next) params.set("next", next);
    const payload = await mexal.getJson(`/articoli?${params.toString()}`);
    if (!Array.isArray(payload?.dati)) {
      throw Object.assign(new Error("Mexal non ha restituito l'anagrafica articoli con i fornitori."), {
        code: "INVALID_MEXAL_ARTICLE_SUPPLIER_MASTER",
      });
    }
    for (const article of payload.dati) {
      const articleCode = clean(article?.codice);
      if (!articleCode) continue;
      for (const supplier of extractArticleMasterSuppliers(article)) {
        relationships.push({
          articleCode,
          supplierCode: supplier.supplierCode,
          priority: supplier.position,
        });
      }
    }
    next = clean(payload.next) || null;
    page += 1;
  } while (next);
  return relationships;
}

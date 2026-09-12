import { getArticleCode, getGroupMap, isActiveArticle, isOutOfProductionLine, loadFullArticle, mapArticleToOrdersCache, resolveHierarchy } from "./sync-products.js";

// Only article codes referenced by the current OCTs are inspected. This function
// never writes; the precheck and importer share exactly the same eligibility rule.
export async function inspectMissingOctArticles({ mexal, codes }) {
  const diagnostics = [];
  const eligible = [];
  if (!codes.length) return { diagnostics, eligible };
  let groups;
  try { groups = await getGroupMap(mexal); } catch { /* Unknown hierarchy fails closed below. */ }
  for (const code of new Set(codes)) {
    let diagnostic = { code, recoverable: false };
    try {
      const article = await loadFullArticle(mexal, code, null);
      if (getArticleCode(article) !== code) {
        diagnostic.reason = "ARTICLE_CODE_MISMATCH";
      } else if (!isActiveArticle(article)) {
        diagnostic.reason = "ARTICLE_INACTIVE";
      } else {
        const hierarchy = groups && resolveHierarchy(article.cod_grp_merc, groups);
        const line = hierarchy?.linea?.descrizione;
        diagnostic.line = line || null;
        if (!line) diagnostic.reason = "ARTICLE_HIERARCHY_UNKNOWN";
        else if (isOutOfProductionLine(line)) diagnostic.reason = "ARTICLE_OUT_OF_PRODUCTION";
        else {
          const row = mapArticleToOrdersCache(article);
          // Restores the reference needed to read an existing OCT, without
          // publishing a product in the sales catalogue or changing Mexal.
          row.mostra_in_app = false;
          eligible.push(row);
          diagnostic = { ...diagnostic, reason: "ACTIVE_ARTICLE_MISSING_FROM_CACHE", recoverable: true };
        }
      }
    } catch {
      diagnostic.reason = "ARTICLE_READ_FAILED";
    }
    diagnostics.push(diagnostic);
  }
  return { diagnostics, eligible };
}

export async function recoverOctArticleReferences({ supabase, eligible }) {
  for (const row of eligible) {
    // A concurrent full catalogue sync takes precedence: never overwrite its row.
    const { error } = await supabase.from("ordini_prodotti_cache")
      .upsert(row, { onConflict: "codice_articolo", ignoreDuplicates: true });
    if (error) throw new Error(`Recupero anagrafica OCT non riuscito per ${row.codice_articolo}.`);
  }
}

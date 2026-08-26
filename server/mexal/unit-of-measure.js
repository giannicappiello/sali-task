function text(value) { return String(value ?? "").trim(); }

export function normalizeMexalUnitOfMeasure(value) {
  return text(value).toUpperCase().replaceAll(".", "").replace(/\s+/g, " ");
}

export function authoritativeArticleUnit(article) {
  for (const candidate of [article?.unita_misura, article?.um_principale, article?.um, article?.unita]) {
    const unit = normalizeMexalUnitOfMeasure(candidate);
    if (unit) return unit;
  }
  return null;
}

export function resolveOctUnitOfMeasure({ explicitUnit, mexalUnitType, article }) {
  const direct = normalizeMexalUnitOfMeasure(explicitUnit);
  if (direct) return { unit: direct, source: "OCT_EXPLICIT" };

  // Mexal usa il tipo "1" per la UDM principale dell'articolo. La sigla viene
  // letta dall'anagrafica completa, non dedotta né sostituita con un fallback.
  if (text(mexalUnitType) === "1") {
    const principal = authoritativeArticleUnit(article);
    if (principal) return { unit: principal, source: "MEXAL_PRIMARY_ARTICLE_UNIT" };
  }

  return { unit: null, source: null };
}

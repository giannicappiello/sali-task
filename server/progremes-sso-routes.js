const DIRECT_OPERATIONAL_SCREEN_ROUTES = Object.freeze({
  "progremes.Ordini.Produzione": "/ordini/produzione",
});

export function progremesDirectOperationalRoute(screenCode) {
  return DIRECT_OPERATIONAL_SCREEN_ROUTES[String(screenCode || "").trim()] || "";
}

export function progremesContextualRoute(screenCode, context = {}, fallback = "") {
  if (String(screenCode || "").trim() === "progremes.Documenti"
      && String(context?.destination || "").trim() === "coa-produzioni") {
    const productionId = Number(context?.productionId);
    if (Number.isSafeInteger(productionId) && productionId > 0) {
      return `/documenti/coa/compila/${productionId}`;
    }

    const query = new URLSearchParams();
    const article = String(context?.article || "").trim();
    const lot = String(context?.lot || "").trim();
    if (article && article.length <= 120) query.set("article", article);
    if (lot && lot.length <= 120) query.set("lot", lot);

    return `/documenti/coa/compila${query.size ? `?${query}` : ""}`;
  }
  return fallback;
}

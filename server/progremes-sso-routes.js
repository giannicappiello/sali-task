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
    return "/documenti/coa/compila";
  }
  return fallback;
}

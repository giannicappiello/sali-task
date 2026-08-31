const DIRECT_OPERATIONAL_SCREEN_ROUTES = Object.freeze({
  "progremes.Ordini.Produzione": "/ordini/produzione",
});

export function progremesDirectOperationalRoute(screenCode) {
  return DIRECT_OPERATIONAL_SCREEN_ROUTES[String(screenCode || "").trim()] || "";
}

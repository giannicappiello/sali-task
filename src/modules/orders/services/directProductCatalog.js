import {
  applyDirectMexalProductFilters,
  isDirectMexalProductCode,
  normalizeDirectProductCode,
} from "../../../../shared/directProductCatalog";

const PAGE_SIZE = 1000;

async function loadAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) return rows;
  }
}

function displayName(product) {
  const raw = product?.json_mexal;
  const mexal = `${String(raw?.descrizione || "").trimEnd()}${String(raw?.descrizione_agg || "").trimStart()}`
    .replace(/\s+/g, " ").trim();
  return mexal || String(product?.nome || "").replace(/\s+/g, " ").trim();
}

export async function loadDirectProductCatalog(db, { includeEconomics = false } = {}) {
  const mexalProductsPromise = loadAll((from, to) => applyDirectMexalProductFilters(
    db.from("prodotti").select("*").range(from, to)
  ).order("nome", { ascending: true }).order("codice_mexal", { ascending: true }));
  const implantsPromise = db.from("ordini_impianti")
    .select("*, componenti:ordini_impianti_componenti(*)")
    .eq("attivo", true)
    .order("descrizione", { ascending: true });
  const economicsPromise = includeEconomics
    ? loadAll((from, to) => db.from("ordini_prodotti_cache").select("*")
      .eq("mostra_in_app", true).range(from, to))
    : Promise.resolve([]);

  const [mexalProducts, implantsResult, economics] = await Promise.all([
    mexalProductsPromise, implantsPromise, economicsPromise,
  ]);
  if (implantsResult.error) throw implantsResult.error;

  const economicsByCode = new Map(economics.map((item) => [
    normalizeDirectProductCode(item.codice_articolo), item,
  ]));
  const products = mexalProducts
    .filter((product) => isDirectMexalProductCode(product.codice_mexal || product.codice))
    .map((product) => {
      const code = normalizeDirectProductCode(product.codice_mexal || product.codice);
      return {
        ...product,
        ...(economicsByCode.get(code) || {}),
        id: product.id,
        codice_articolo: code,
        codice_mexal: code,
        descrizione: displayName(product),
        nome: displayName(product),
        attivo_mexal: true,
        mostra_in_app: true,
      };
    });

  const implants = (implantsResult.data || []).filter((item) => normalizeDirectProductCode(item.codice).startsWith("IMP"));
  return { products, implants };
}

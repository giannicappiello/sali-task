function normalize(value) {
  return String(value ?? "").trim();
}

export async function enrichOrderLinesWithBarcode(db, lines = []) {
  const missingCodes = [...new Set(lines
    .filter((line) => !normalize(line?.ean))
    .map((line) => normalize(line?.codice_articolo || line?.codice))
    .filter(Boolean))];

  if (!missingCodes.length) return lines;

  const { data, error } = await db
    .from("ordini_prodotti_cache")
    .select("codice_articolo,ean")
    .in("codice_articolo", missingCodes);
  if (error) throw error;

  const barcodeByCode = new Map((data || [])
    .map((product) => [normalize(product.codice_articolo).toUpperCase(), normalize(product.ean)])
    .filter(([, ean]) => Boolean(ean)));

  return lines.map((line) => {
    if (normalize(line?.ean)) return line;
    const code = normalize(line?.codice_articolo || line?.codice).toUpperCase();
    return barcodeByCode.has(code) ? { ...line, ean: barcodeByCode.get(code) } : line;
  });
}

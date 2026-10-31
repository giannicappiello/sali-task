// QR contents are data: extract an article identifier without opening URLs.
export function productCodeInScan(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096)
    throw new Error("Inserisci un barcode, un codice IT o un URL QR valido (massimo 4096 caratteri).");
  let decoded = value.trim();
  for (let i = 0; i < 2; i++) {
    try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; }
    catch { break; }
  }
  const codes = [...new Set((decoded.toUpperCase().match(/\bIT[0-9]+[A-Z0-9]*(?:[-_][A-Z0-9]+)*\b/g) || []))];
  if (codes.length > 1) throw new Error("Il QR contiene più codici IT: inserisci il codice del prodotto desiderato.");
  return codes[0] || null;
}

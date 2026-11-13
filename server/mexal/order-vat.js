import { getArticleCode, getMexalVat, loadFullArticle } from "./sync-products.js";

import { applyOrderVatPolicy, isForeignOrderCustomer } from "../../src/modules/orders/services/orderVatPolicy.js";

const text = (value) => String(value ?? "").trim();

// Mexal's customer-specific fiscal treatment is synchronized verbatim.
// A foreign order needs that exemption code, rather than a blank VAT matrix cell.
export function customerMexalVatExemption(customer) {
  let value = customer?.dati_mexal?.assog_iva ?? customer?.assog_iva;
  while (Array.isArray(value)) value = value.at(-1);
  const code = typeof value === 'string' || typeof value === 'number' ? text(value).toUpperCase() : '';
  if (!/^[A-Z0-9]+(?:[,.][0-9]+)?$/.test(code) || code.length > 20) return null;
  // Never replace an absent exemption with an ordinary positive article rate.
  if (/^[0-9]+(?:[,.][0-9]+)?$/.test(code) && Number(code.replace(',', '.')) > 0) return null;
  return code;
}

// Validate every pending document before the first POST. Missing snapshots are
// repaired from the authoritative article, never by assuming a default VAT.
export async function prepareOrderVat(documents, mexal, { loadArticle = loadFullArticle, customer } = {}) {
  if (isForeignOrderCustomer(customer)) {
    const exemption = customerMexalVatExemption(customer);
    if (!exemption && Object.values(documents).some(lines => lines.length)) {
      throw new Error(`Codice di esenzione IVA non configurato nell’anagrafica Mexal del cliente ${text(customer?.codice_cliente) || 'estero'}. Verificare il campo assog_iva e sincronizzare i clienti. Nessun nuovo documento inviato.`);
    }
    return { documents: Object.fromEntries(Object.entries(documents).map(([kind, lines]) =>
      [kind, lines.map((line) => ({ ...applyOrderVatPolicy(line, customer), codice_esenzione_iva_mexal: exemption }))])), updates: [] };
  }
  const repairs = new Map();
  const missing = new Map();
  for (const [kind, lines] of Object.entries(documents)) {
    lines.forEach((line, index) => {
      if (line.riga_spedizione === true) return;
      if (text(line.cod_iva) || text(line.codice_iva_mexal)) return;
      const code = text(line.codice_articolo).toUpperCase();
      if (!missing.has(code)) missing.set(code, { kind, row: index + 1, line });
    });
  }
  const entries = [...missing];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, entries.length) }, async () => {
    while (next < entries.length) {
      const [code, context] = entries[next++];
      const label = `${context.kind}, riga ${context.row}: ${code} (${text(context.line.descrizione) || "descrizione non disponibile"})`;
      let article;
      try {
        article = await loadArticle(mexal, code);
      } catch {
        throw new Error(`IVA non verificabile in Mexal per ${label}. Nessun nuovo documento inviato; riprovare la verifica.`);
      }
      const vat = getMexalVat(article || {});
      if (!article || getArticleCode(article) !== code || !vat.code) {
        throw new Error(`Codice IVA non restituito da Mexal per ${label}. Nessun nuovo documento inviato.`);
      }
      repairs.set(code, vat);
    }
  }));

  const updates = new Map();
  const prepared = Object.fromEntries(Object.entries(documents).map(([kind, lines]) => [kind, lines.map((line) => {
    if (line.riga_spedizione === true) return line;
    const snapshot = text(line.cod_iva) || text(line.codice_iva_mexal);
    if (snapshot) return { ...line, cod_iva: snapshot };
    const vat = repairs.get(text(line.codice_articolo).toUpperCase());
    const repaired = { ...line, cod_iva: vat.code, codice_iva_mexal: vat.code, aliquota_iva: vat.rate ?? line.aliquota_iva ?? null };
    if (line.id) updates.set(line.id, { id: line.id, codice_iva_mexal: repaired.codice_iva_mexal, aliquota_iva: repaired.aliquota_iva });
    return repaired;
  })]));
  return { documents: prepared, updates: [...updates.values()] };
}

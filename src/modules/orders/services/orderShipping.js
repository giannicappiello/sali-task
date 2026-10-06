import { calculateOrderEconomics, calculateOrderLineEconomicsWithPayment, roundCurrency } from "./orderEconomics.js";

export function isShippingLine(line) {
  return line?.riga_spedizione === true;
}

export function normalizeShippingConfig(config = {}) {
  const result = {};
  for (const key of ["importo_minimo_porto_franco", "addebito_spedizione"]) {
    const value = Number(String(config[key] ?? "0").trim().replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 9999999999.99) {
      throw new Error("Gli importi di spedizione devono essere numeri non negativi validi.");
    }
    result[key] = roundCurrency(value);
  }
  return result;
}

// Shipping is an accessory charge, never an article, a stock quantity or a
// commission. Rebuilding from products makes recalculation idempotent.
export function applyOrderShipping(lines = [], config = {}, { moduleCode = "prof", reservation = false } = {}) {
  const policy = normalizeShippingConfig(config);
  const products = lines.filter((line) => !isShippingLine(line));
  const economics = calculateOrderEconomics(products);
  const net = economics.totale_imponibile;
  if (!products.some((line) => !line.riga_descrittiva) || net >= policy.importo_minimo_porto_franco || policy.addebito_spedizione === 0) return products;
  const goods = products.filter((line) => !line.riga_descrittiva);
  const importLine = (line) => String(line.codice_articolo || "").toUpperCase().startsWith("IMP");
  const quantity = (line, kind) => importLine(line) ? (kind === "OCM" ? Number(line.quantita) : 0)
    : reservation ? (kind === "OCI" ? Number(line.quantita) : 0) : Number(line[`quantita_${kind.toLowerCase()}`] || 0);
  const recipient = ["private", "ph"].includes(moduleCode) ? null : ["OCM", "OCX", "OCI"].find((kind) => goods.some((line) => quantity(line, kind) > 0));
  const vatGoods = recipient ? goods.filter((line) => quantity(line, recipient) > 0).map((line) => ({ ...line, quantita_documento: quantity(line, recipient) })) : goods;
  const groups = new Map();
  for (const original of vatGoods) {
    const line = calculateOrderLineEconomicsWithPayment(original);
    const rate = Number(line.aliquota_iva || 0);
    groups.set(rate, (groups.get(rate) || 0) + Math.max(0, line.imponibile_riga));
  }
  const rates = [...groups.entries()].sort(([a], [b]) => a - b);
  const taxable = rates.reduce((sum, [, amount]) => sum + amount, 0);
  let allocated = 0;
  const split = rates.map(([rate, amount], index) => {
    const share = index === rates.length - 1 ? roundCurrency(policy.addebito_spedizione - allocated)
      : roundCurrency(policy.addebito_spedizione * (taxable > 0 ? amount / taxable : 1 / rates.length));
    allocated = roundCurrency(allocated + share);
    return { aliquota_iva: rate, imponibile_riga: share, iva_riga: roundCurrency(share * rate / 100) };
  });
  const foreign = products.some((line) => line.iva_non_applicata);
  const vat = roundCurrency(split.reduce((sum, group) => sum + group.iva_riga, 0));
  return [...products, {
    codice_articolo: null,
    descrizione: "Spese di spedizione",
    riga_spedizione: true,
    riga_descrittiva: true,
    quantita: 1,
    quantita_disponibile: 0, quantita_ocm: 0, quantita_ocx: 0, quantita_oci: 0,
    prezzo_listino: policy.addebito_spedizione,
    prezzo_netto: policy.addebito_spedizione,
    sconto_percentuale: 0, sconto_commerciale: "", sconto_pagamento: "",
    origine_prezzo: "configurazione-spedizione",
    iva_non_applicata: foreign,
    aliquota_iva: foreign ? null : split.length === 1 ? split[0].aliquota_iva : 0,
    codice_iva_mexal: null,
    imponibile_riga: policy.addebito_spedizione,
    iva_riga: vat,
    totale_riga: roundCurrency(policy.addebito_spedizione + vat),
    dettaglio_calcolo: { ...policy, netto_merce: net, documento_spedizione: recipient, ripartizione_iva: foreign ? [] : split },
  }];
}

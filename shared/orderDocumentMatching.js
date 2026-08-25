import { isDirectProductCode } from "./directProductCatalog.js";

function normalized(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}
function compact(value) { return normalized(value).replace(/\s+/g, ""); }
function fiscalKey(value) { const key = compact(value); return /^IT\d{11}$/.test(key) ? key.slice(2) : key; }
function tokenSimilarity(left, right) {
  const a = new Set(normalized(left).split(" ").filter((token) => token.length > 1));
  const b = new Set(normalized(right).split(" ").filter((token) => token.length > 1));
  if (!a.size || !b.size) return 0;
  return [...a].filter((token) => b.has(token)).length / Math.max(a.size, b.size);
}

const COMPANY_FORM_TOKENS = new Set(["SRL", "SPA", "SNC", "SAS", "SS", "SCARL", "COOP", "COOPERATIVA", "SOCIETA"]);
function normalizedName(value) { return normalized(value).split(" ").filter((token) => token && !COMPANY_FORM_TOKENS.has(token)).join(" "); }
function valuesOf(record, fields) { return fields.flatMap((field) => Array.isArray(record?.[field]) ? record[field] : [record?.[field]]).map((value) => String(value || "").trim()).filter(Boolean); }
function exactAny(source, values, transform = compact) { const key = transform(source); return Boolean(key && values.some((value) => transform(value) === key)); }

function decision(candidates, exactMethods) {
  const top = candidates[0];
  if (!top || top.score < 0.45) return { proposedId: null, confidence: 0, reason: "Nessun candidato supera la soglia minima.", alternatives: [], status: "unmatched" };
  const second = candidates[1];
  const tied = second && Math.abs(top.score - second.score) < 0.08;
  const status = exactMethods.has(top.matchMethod) && !tied ? "matched" : tied ? "ambiguous" : top.score >= 0.72 ? "probable" : "unmatched";
  return {
    proposedId: status === "unmatched" ? null : top.code,
    confidence: Number(top.score.toFixed(3)),
    reason: status === "ambiguous" ? "Più candidati hanno indicatori comparabili; è richiesta una conferma." : top.reason,
    alternatives: candidates.slice(status === "ambiguous" ? 0 : 1, 5).map(({ code, name, description, score, reason }) => ({ identifier: code, label: name || description || code, confidence: Number(score.toFixed(3)), reason })),
    status,
  };
}

export function rankCustomerCandidates(extracted, customers) {
  const sourceCode = compact(extracted?.code); const sourceVat = fiscalKey(extracted?.vatNumber); const sourceTax = compact(extracted?.taxCode);
  const sourceNames = valuesOf(extracted, ["name", "alias"]).map(normalizedName).filter(Boolean); const sourceEmail = compact(extracted?.email); const sourceCity = normalized(extracted?.city); const sourceAddress = normalized(extracted?.address);
  return (customers || []).map((customer) => {
    const code = compact(customer.codice_cliente); const vat = fiscalKey(customer.partita_iva); const tax = compact(customer.codice_fiscale);
    const names = valuesOf(customer, ["ragione_sociale", "denominazione", "alias", "aliases"]); const emails = valuesOf(customer, ["email", "email_amministrativa", "pec"]);
    const normalizedCustomerNames = names.map(normalizedName);
    const nameScore = Math.max(0, ...sourceNames.flatMap((sourceName) => normalizedCustomerNames.map((name) => tokenSimilarity(sourceName, name))));
    const nameExact = sourceNames.some((sourceName) => normalizedCustomerNames.includes(sourceName)); const emailExact = exactAny(sourceEmail, emails);
    const cityMatch = Boolean(sourceCity && sourceCity === normalized(customer.localita || customer.citta)); const addressMatch = Boolean(sourceAddress && tokenSimilarity(sourceAddress, customer.indirizzo) >= 0.7);
    let score = nameExact ? 0.84 : nameScore * 0.72; let matchMethod = nameExact ? "exact_name" : "normalized_name"; let reason = nameExact ? "Ragione sociale normalizzata esatta." : "Somiglianza della ragione sociale normalizzata.";
    if (sourceCode && sourceCode === code) { score = 1; matchMethod = "customer_code"; reason = "Codice cliente Mexal esatto."; }
    else if (sourceVat && sourceVat === vat) { score = 0.99; matchMethod = "vat"; reason = "Partita IVA esatta."; }
    else if (sourceTax && sourceTax === tax) { score = 0.98; matchMethod = "tax_code"; reason = "Codice fiscale esatto."; }
    else if (emailExact) { score = Math.max(score, nameScore >= 0.5 ? 0.93 : 0.78); matchMethod = nameScore >= 0.5 ? "email_confirmed" : "email_only"; reason = "Email esatta" + (nameScore >= 0.5 ? " e denominazione coerente." : "; manca una seconda conferma anagrafica."); }
    if (matchMethod === "exact_name" && (cityMatch || addressMatch)) { score = Math.max(score, 0.9); reason += cityMatch ? " Città coerente." : " Indirizzo coerente."; }
    return { code: customer.codice_cliente, name: customer.ragione_sociale || names[0], city: customer.localita || customer.citta || "", vatNumber: customer.partita_iva || "", email: emails[0] || "", score, matchMethod, reason };
  }).filter((item) => item.score >= 0.2).sort((a, b) => b.score - a.score || String(a.code).localeCompare(String(b.code))).slice(0, 5);
}
export function matchCustomer(extracted, customers) { const candidates = rankCustomerCandidates(extracted, customers); return { candidates, match: decision(candidates, new Set(["customer_code", "vat", "tax_code", "email_confirmed"])) }; }

export function rankProductCandidates(extracted, products) {
  const sourceCode = compact(extracted?.productCode); const sourceEan = compact(extracted?.ean); const sourceText = compact([extracted?.sourceText, extracted?.description].filter(Boolean).join(" "));
  const sourceSku = compact(extracted?.sku); const sourceDescription = normalized(extracted?.description); const sourceFormat = normalized(extracted?.format || extracted?.package);
  return (products || []).filter((product) => isDirectProductCode(product.codice_articolo || product.codice_mexal || product.codice)).map((product) => {
    const code = product.codice_articolo || product.codice_mexal || product.codice; const productCode = compact(code); const productEan = compact(product.ean);
    const descriptions = valuesOf(product, ["descrizione", "nome", "alias", "aliases"]); const descriptionScore = Math.max(0, ...descriptions.map((value) => tokenSimilarity(extracted?.description || extracted?.sourceText, value)));
    const descriptionExact = Boolean(sourceDescription && descriptions.some((value) => normalized(value) === sourceDescription)); const productSkus = valuesOf(product, ["sku", "codice_articolo", "codice_mexal", "codice"]);
    const formatMatch = Boolean(sourceFormat && valuesOf(product, ["formato", "confezione", "package"]).some((value) => tokenSimilarity(sourceFormat, value) >= 0.75));
    let score = descriptionExact ? 0.88 : descriptionScore * 0.78; let matchMethod = descriptionExact ? "exact_description" : "normalized_description"; let reason = descriptionExact ? "Descrizione normalizzata esatta." : "Somiglianza della descrizione normalizzata.";
    if (sourceCode && sourceCode === productCode) { score = 1; matchMethod = "product_code"; reason = "Codice articolo esatto."; }
    else if (sourceEan && sourceEan === productEan) { score = 1; matchMethod = "ean"; reason = "EAN esatto."; }
    else if (sourceSku && exactAny(sourceSku, productSkus)) { score = 0.99; matchMethod = "sku"; reason = "SKU esatto."; }
    else if (productEan.length >= 8 && sourceText.includes(productEan)) { score = 0.99; matchMethod = "ean"; reason = "EAN individuato nel testo della riga."; }
    else if (productCode.length >= 3 && sourceText.includes(productCode)) { score = 0.97; matchMethod = "product_code"; reason = "Codice articolo individuato nel testo della riga."; }
    if (formatMatch && score < 0.95) { score = Math.min(0.94, score + 0.06); reason += " Formato/confezione coerente."; }
    return { code, description: product.descrizione || product.nome || code, ean: product.ean || "", score, matchMethod, reason };
  }).filter((item) => item.code && item.score >= 0.18).sort((a, b) => b.score - a.score || String(a.code).localeCompare(String(b.code))).slice(0, 5);
}
export function matchProduct(extracted, products) { const candidates = rankProductCandidates(extracted, products); return { candidates, match: decision(candidates, new Set(["product_code", "ean", "sku"])) }; }

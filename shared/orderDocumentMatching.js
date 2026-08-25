import { isDirectProductCode } from "./directProductCatalog.js";

const COMPANY_FORMS = new Set(["SRL", "SRLS", "SPA", "SNC", "SAS", "SS", "SCARL", "SCPA", "COOP", "COOPERATIVA", "SOCIETA", "DITTA"]);
const CUSTOMER_GENERIC = new Set(["FARMACIA", "PARAFARMACIA", "AZIENDA", "SOCIETA", "CENTRO", "STUDIO", "DI", "DE", "DEL", "DELLA", "LA", "LE", "IL", "E"]);
const PRODUCT_GENERIC = new Set(["SALI", "ISCHIA", "PRODOTTO", "PRODOTTI", "COSMETICO", "COSMETICI", "ML", "GR", "G", "KG", "LT", "L", "PZ", "PEZZI", "DI", "DA", "PER", "CON"]);
const PACKAGING_TERMS = new Set(["ETICHETTA", "ETICHETTE", "PACKAGING", "ASTUCCIO", "ASTUCCI", "TAPPO", "TAPPI", "FLACONE", "FLACONI", "SCATOLA", "SCATOLE", "COMPONENTE", "COMPONENTI", "SEMILAVORATO", "SEMILAVORATI", "IMBALLO", "IMBALLAGGIO"]);
const EXACT_CUSTOMER_METHODS = new Set(["customer_code", "vat", "tax_code", "exact_name", "exact_name_without_form", "exact_alias"]);
const EXACT_PRODUCT_METHODS = new Set(["product_code", "ean", "sku", "exact_description"]);

export function normalizeOrderText(value) {
  return String(value ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\bS\W*R\W*L\W*S?\b/gi, (match) => /S\W*$/i.test(match) ? " SRLS " : " SRL ")
    .replace(/\bS\W*P\W*A\b/gi, " SPA ")
    .replace(/\bS\W*N\W*C\b/gi, " SNC ")
    .replace(/\bS\W*A\W*S\b/gi, " SAS ")
    .replace(/[’'`´]/g, " ")
    .toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function compact(value) { return normalizeOrderText(value).replace(/\s+/g, ""); }
function fiscalKey(value) { const key = compact(value); return /^IT\d{11}$/.test(key) ? key.slice(2) : key; }
function tokens(value) { return normalizeOrderText(value).split(" ").filter(Boolean); }
function withoutCompanyForm(value) { return tokens(value).filter((token) => !COMPANY_FORMS.has(token)).join(" "); }
function valuesOf(record, fields) {
  const nested = [record, record?.json_mexal, record?.dati_mexal].filter((item) => item && typeof item === "object");
  return nested.flatMap((source) => fields.flatMap((field) => Array.isArray(source?.[field]) ? source[field] : [source?.[field]]))
    .map((value) => String(value || "").trim()).filter(Boolean);
}
function exactAny(source, values, transform = compact) { const key = transform(source); return Boolean(key && values.some((value) => transform(value) === key)); }

function tokenMatch(left, right) {
  if (left === right) return 1;
  const shorter = left.length <= right.length ? left : right;
  const longer = shorter === left ? right : left;
  if (shorter.length >= 4 && longer.startsWith(shorter)) return 0.88;
  if (shorter.length >= 2 && longer.startsWith(shorter) && !PRODUCT_GENERIC.has(shorter)) return 0.72;
  return 0;
}

function weightedTokenSimilarity(left, right, { generic = new Set(), frequencies = null, population = 1 } = {}) {
  const a = [...new Set(tokens(left))]; const b = [...new Set(tokens(right))];
  if (!a.length || !b.length) return { score: 0, distinctiveMatches: 0 };
  const weight = (token) => {
    if (generic.has(token)) return 0.12;
    if (/^\d+$/.test(token)) return token.length >= 2 ? 0.7 : 0.35;
    const frequency = frequencies?.get(token) || 0;
    return frequencies ? Math.min(3.2, 1 + Math.log((population + 1) / (frequency + 1))) : 1;
  };
  let intersection = 0; let distinctiveMatches = 0;
  for (const source of a) {
    const quality = Math.max(0, ...b.map((target) => tokenMatch(source, target)));
    if (!quality) continue;
    intersection += weight(source) * quality;
    if (!generic.has(source) && source.length >= 2 && quality >= 0.7) distinctiveMatches += 1;
  }
  const total = Math.max(a.reduce((sum, token) => sum + weight(token), 0), b.reduce((sum, token) => sum + weight(token), 0));
  return { score: total ? intersection / total : 0, distinctiveMatches };
}

function editSimilarity(left, right) {
  const a = compact(left); const b = compact(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function alternativesFor(candidates, startIndex, topScore) {
  const minimum = Math.max(0.55, topScore - 0.16);
  return candidates.slice(startIndex).filter((candidate) => candidate.score >= minimum && candidate.semantic !== false).slice(0, 3)
    .map(({ code, name, description, score, reason }) => ({ identifier: code, label: name || description || code, confidence: Number(score.toFixed(3)), reason }));
}

function decision(candidates, exactMethods) {
  const top = candidates[0];
  if (!top || top.score < 0.58 || top.semantic === false) return { proposedId: null, confidence: 0, reason: "Nessun candidato anagraficamente plausibile supera la soglia minima.", alternatives: [], status: "unmatched" };
  const second = candidates[1];
  const tied = Boolean(second && second.semantic !== false && second.score >= 0.58 && top.score - second.score < (exactMethods.has(top.matchMethod) ? 0.025 : 0.1));
  let status = "unmatched";
  if (tied) status = "ambiguous";
  else if (exactMethods.has(top.matchMethod)) status = "matched";
  else if (top.score >= 0.78) status = "probable";
  else if (top.score >= 0.64) status = "ambiguous";
  return {
    proposedId: status === "unmatched" ? null : top.code,
    confidence: Number(top.score.toFixed(3)),
    reason: tied ? "Più candidati plausibili hanno indicatori comparabili; è richiesta una conferma." : top.reason,
    alternatives: alternativesFor(candidates, status === "ambiguous" ? 0 : 1, top.score),
    status,
  };
}

export function distinctiveCustomerTokens(value) {
  return tokens(withoutCompanyForm(value)).filter((token) => token.length >= 2 && !CUSTOMER_GENERIC.has(token));
}

export function rankCustomerCandidates(extracted, customers) {
  const sourceCode = compact(extracted?.code); const sourceVat = fiscalKey(extracted?.vatNumber); const sourceTax = compact(extracted?.taxCode);
  const rawNames = valuesOf(extracted, ["name", "alias"]); const sourceEmail = compact(extracted?.email); const sourceCity = normalizeOrderText(extracted?.city); const sourceAddress = normalizeOrderText(extracted?.address);
  return (customers || []).map((customer) => {
    const code = compact(customer.codice_cliente); const vat = fiscalKey(valuesOf(customer, ["partita_iva", "piva", "vat_number"])[0]); const tax = compact(valuesOf(customer, ["codice_fiscale", "cod_fiscale", "cf"])[0]);
    const primaryNames = valuesOf(customer, ["ragione_sociale", "denominazione"]); const aliases = valuesOf(customer, ["alias", "aliases", "nome_commerciale"]); const allNames = [...primaryNames, ...aliases];
    const emails = valuesOf(customer, ["email", "email_amministrativa", "pec"]);
    const exactFullName = rawNames.some((source) => primaryNames.some((name) => normalizeOrderText(name) === normalizeOrderText(source)));
    const exactNameWithoutForm = rawNames.some((source) => primaryNames.some((name) => withoutCompanyForm(name) === withoutCompanyForm(source)));
    const exactAlias = rawNames.some((source) => aliases.some((name) => withoutCompanyForm(name) === withoutCompanyForm(source)));
    let bestName = { score: 0, distinctiveMatches: 0 }; let bestEdit = 0;
    for (const source of rawNames) for (const name of allNames) {
      const similarity = weightedTokenSimilarity(withoutCompanyForm(source), withoutCompanyForm(name), { generic: CUSTOMER_GENERIC });
      if (similarity.score > bestName.score) bestName = similarity;
      bestEdit = Math.max(bestEdit, editSimilarity(withoutCompanyForm(source), withoutCompanyForm(name)));
    }
    const cityMatch = Boolean(sourceCity && valuesOf(customer, ["localita", "citta"]).some((value) => normalizeOrderText(value) === sourceCity));
    const addressMatch = Boolean(sourceAddress && valuesOf(customer, ["indirizzo"]).some((value) => weightedTokenSimilarity(sourceAddress, value).score >= 0.72));
    const emailExact = exactAny(sourceEmail, emails);
    let score = bestName.distinctiveMatches ? Math.min(0.86, 0.22 + bestName.score * 0.72 + bestEdit * 0.08) : 0;
    let matchMethod = "fuzzy_name"; let reason = "Somiglianza deterministica dei token distintivi della ragione sociale.";
    if (sourceCode && sourceCode === code) { score = 1; matchMethod = "customer_code"; reason = "Codice cliente Mexal esatto."; }
    else if (sourceVat && sourceVat === vat) { score = 0.99; matchMethod = "vat"; reason = "Partita IVA esatta."; }
    else if (sourceTax && sourceTax === tax) { score = 0.99; matchMethod = "tax_code"; reason = "Codice fiscale esatto."; }
    else if (exactFullName) { score = 0.97; matchMethod = "exact_name"; reason = "Ragione sociale normalizzata esatta."; }
    else if (exactNameWithoutForm) { score = 0.94; matchMethod = "exact_name_without_form"; reason = "Ragione sociale esatta dopo la rimozione della forma societaria."; }
    else if (exactAlias) { score = 0.92; matchMethod = "exact_alias"; reason = "Alias o denominazione equivalente esatta."; }
    else if (emailExact) { score = bestName.distinctiveMatches ? Math.max(score, 0.88) : 0.79; matchMethod = "email_confirmed"; reason = bestName.distinctiveMatches ? "Email esatta e denominazione coerente." : "Email esatta; è richiesta conferma perché manca un nome distintivo coerente."; }
    if (!["customer_code", "vat", "tax_code"].includes(matchMethod) && (cityMatch || addressMatch) && bestName.distinctiveMatches) {
      score = Math.min(matchMethod.startsWith("exact_") ? 0.98 : 0.91, score + 0.04); reason += cityMatch ? " Località coerente." : " Indirizzo coerente.";
    }
    const semantic = ["customer_code", "vat", "tax_code"].includes(matchMethod) || bestName.distinctiveMatches > 0 || emailExact;
    return { code: customer.codice_cliente, name: customer.ragione_sociale || primaryNames[0], city: customer.localita || customer.citta || "", vatNumber: customer.partita_iva || "", email: emails[0] || "", score, matchMethod, reason, semantic };
  }).filter((item) => item.code && item.semantic && item.score >= 0.2).sort((a, b) => b.score - a.score || String(a.code).localeCompare(String(b.code))).slice(0, 8);
}

export function matchCustomer(extracted, customers) { const candidates = rankCustomerCandidates(extracted, customers); return { candidates: candidates.slice(0, 4), match: decision(candidates, EXACT_CUSTOMER_METHODS) }; }

function productDescription(product) { return valuesOf(product, ["descrizione", "nome"])[0] || String(product?.codice_articolo || product?.codice_mexal || product?.codice || ""); }
function hasPackagingMeaning(value) { return tokens(value).some((token) => PACKAGING_TERMS.has(token)); }
function productTypeText(product) { return valuesOf(product, ["tipologia", "tipo_articolo", "categoria", "categoria_articolo", "descrizione", "nome"]).join(" "); }
function sourceClearlyFinished(extracted) { const value = [extracted?.sourceText, extracted?.description].filter(Boolean).join(" "); return Boolean(value && !hasPackagingMeaning(value)); }
function productTokenFrequencies(products) {
  const frequencies = new Map();
  for (const product of products) for (const token of new Set(tokens(productDescription(product)))) frequencies.set(token, (frequencies.get(token) || 0) + 1);
  return frequencies;
}

export function rankProductCandidates(extracted, products) {
  const catalog = (products || []).filter((product) => isDirectProductCode(product.codice_articolo || product.codice_mexal || product.codice));
  const frequencies = productTokenFrequencies(catalog); const sourceCode = compact(extracted?.productCode); const sourceEan = compact(extracted?.ean); const sourceSku = compact(extracted?.sku);
  const sourceText = compact([extracted?.sourceText, extracted?.description].filter(Boolean).join(" ")); const sourceDescription = normalizeOrderText(extracted?.description); const sourceFormat = normalizeOrderText(extracted?.format || extracted?.package);
  const finishedSource = sourceClearlyFinished(extracted);
  return catalog.map((product) => {
    const code = product.codice_articolo || product.codice_mexal || product.codice; const productCode = compact(code); const productEan = compact(valuesOf(product, ["ean", "barcode"])[0]);
    const descriptions = valuesOf(product, ["descrizione", "nome", "alias", "aliases"]); const productSkus = valuesOf(product, ["sku", "codice_articolo", "codice_mexal", "codice"]);
    const blockedType = finishedSource && hasPackagingMeaning(productTypeText(product));
    let best = { score: 0, distinctiveMatches: 0 };
    for (const description of descriptions) {
      const similarity = weightedTokenSimilarity(extracted?.description || extracted?.sourceText, description, { generic: PRODUCT_GENERIC, frequencies, population: catalog.length });
      if (similarity.score > best.score) best = similarity;
    }
    const descriptionExact = Boolean(sourceDescription && descriptions.some((value) => normalizeOrderText(value) === sourceDescription));
    const formatMatch = Boolean(sourceFormat && valuesOf(product, ["formato", "confezione", "package"]).some((value) => weightedTokenSimilarity(sourceFormat, value).score >= 0.72));
    let score = best.distinctiveMatches ? Math.min(0.91, (best.distinctiveMatches >= 2 ? 0.3 : 0.18) + best.score * 0.85 + (formatMatch ? 0.05 : 0)) : 0;
    let matchMethod = best.distinctiveMatches >= 2 ? "family_variant_format" : "fuzzy_description"; let reason = best.distinctiveMatches >= 2 ? "Famiglia/variante del prodotto coerenti; verificare formato e confezione." : "Somiglianza limitata della descrizione normalizzata.";
    if (sourceCode && sourceCode === productCode) { score = 1; matchMethod = "product_code"; reason = "Codice articolo esatto."; }
    else if (sourceEan && sourceEan === productEan) { score = 1; matchMethod = "ean"; reason = "EAN esatto."; }
    else if (sourceSku && exactAny(sourceSku, productSkus)) { score = 0.995; matchMethod = "sku"; reason = "SKU esatto."; }
    else if (productEan.length >= 8 && sourceText.includes(productEan)) { score = 0.995; matchMethod = "ean"; reason = "EAN individuato nel testo della riga."; }
    else if (productCode.length >= 3 && sourceText.includes(productCode)) { score = 0.99; matchMethod = "product_code"; reason = "Codice articolo individuato nel testo della riga."; }
    else if (descriptionExact) { score = 0.96; matchMethod = "exact_description"; reason = "Descrizione normalizzata esatta."; }
    if (blockedType && !["product_code", "ean", "sku"].includes(matchMethod)) { score = 0; reason = "Candidato escluso: tipologia packaging/componente incompatibile con un prodotto finito."; }
    const semantic = !blockedType && (["product_code", "ean", "sku", "exact_description"].includes(matchMethod) || best.distinctiveMatches > 0);
    return { code, description: productDescription(product), ean: productEan, score, matchMethod, reason, semantic };
  }).filter((item) => item.code && item.semantic && item.score >= 0.2).sort((a, b) => b.score - a.score || String(a.code).localeCompare(String(b.code))).slice(0, 8);
}

export function matchProduct(extracted, products) { const candidates = rankProductCandidates(extracted, products); return { candidates: candidates.slice(0, 4), match: decision(candidates, EXACT_PRODUCT_METHODS) }; }

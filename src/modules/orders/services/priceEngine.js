function text(value) {
  return String(value ?? "").trim();
}

export function parseMexalNumber(value, fallback = 0) {
  const parsed = Number(text(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseDiscountChain(value) {
  return text(value)
    .replace(/%/g, "")
    .split(/[+;/]/)
    .map((item) => parseMexalNumber(item, NaN))
    .filter((item) => Number.isFinite(item) && item > -100 && item < 100);
}

export function applyDiscountChain(amount, chain) {
  return parseDiscountChain(chain).reduce(
    (current, discount) => current * (1 - discount / 100),
    Number(amount || 0)
  );
}

export function equivalentDiscount(...chains) {
  const start = 100;
  const end = chains.reduce((amount, chain) => applyDiscountChain(amount, chain), start);
  return Number((100 - end).toFixed(4));
}

function customerData(customer) {
  return customer?.dati_mexal || customer?.json_mexal || {};
}

function productData(product) {
  return product?.dati_mexal || product?.json_mexal || {};
}

function customerCategory(customer) {
  const data = customerData(customer);
  return Number(customer?.categoria_sconto_cliente ?? customer?.cod_cat_sconti ?? data?.cod_cat_sconti ?? data?.id_cat_sconto ?? 0);
}

function customerStatCategory(customer) {
  const data = customerData(customer);
  return Number(customer?.categoria_statistica_cliente ?? data?.id_catsta_conto ?? data?.nr_cat_sta ?? 0);
}

function productDiscountCategory(product) {
  const data = productData(product);
  return Number(product?.categoria_sconto_articolo ?? product?.id_cat_sconto ?? data?.id_cat_sconto ?? 0);
}

function productStatCategory(product) {
  const data = productData(product);
  return Number(product?.categoria_statistica_articolo ?? product?.nr_cat_sta ?? data?.nr_cat_sta ?? 0);
}

function productNature(product) {
  const data = productData(product);
  return text(product?.natura_articolo ?? product?.cod_natura ?? data?.cod_natura);
}

function productGroup(product) {
  const data = productData(product);
  return text(product?.gruppo_merceologico ?? product?.cod_grp_merc ?? data?.cod_grp_merc);
}

function inDateRange(rule, date) {
  const value = text(date).replace(/-/g, "").slice(0, 8);
  const start = text(rule.data_inizio).replace(/-/g, "").slice(0, 8);
  const end = text(rule.data_fine).replace(/-/g, "").slice(0, 8);
  return (!start || value >= start) && (!end || value <= end);
}

function matchCustomer(rule, customer) {
  const type = text(rule.tp_dato_conto);
  if (type === "C") return text(rule.codice_conto) === text(customer?.codice_cliente);
  if (type === "N") return Number(rule.id_cat_conto || 0) === customerCategory(customer);
  if (type === "S") return Number(rule.id_catsta_conto || 0) === customerStatCategory(customer);
  return false;
}

function matchProduct(rule, product) {
  const type = text(rule.tp_dato_art);
  const code = text(product?.codice_articolo || product?.codice_mexal || product?.codice);
  if (type === "A") return text(rule.cod_articolo) === code;
  if (type === "T") return Number(rule.id_cat_art || 0) === productDiscountCategory(product);
  if (type === "M") {
    const ruleGroup = text(rule.cod_grp_merc);
    const group = productGroup(product);
    return Boolean(ruleGroup && group && (group === ruleGroup || group.startsWith(ruleGroup)));
  }
  if (type === "E") return Number(rule.nr_catsta_art || 0) === productStatCategory(product);
  if (type === "U") return text(rule.cod_natura) === productNature(product);
  return false;
}

function specificity(rule) {
  const customerScores = { C: 300, N: 200, S: 100 };
  const productScores = { A: 50, T: 40, M: 30, E: 20, U: 10 };
  return (customerScores[text(rule.tp_dato_conto)] || 0) + (productScores[text(rule.tp_dato_art)] || 0);
}

function ruleValue(rule) {
  const first = Array.isArray(rule.part_1) ? rule.part_1.find((item) => text(item?.[1])) : null;
  const second = Array.isArray(rule.part_2) ? rule.part_2.find((item) => text(item?.[1])) : null;
  return text(first?.[1] ?? second?.[1]);
}

function bestRule(rules, type, customer, product, orderDate) {
  return (rules || [])
    .filter((rule) => text(rule.tipo_part) === type)
    .filter((rule) => inDateRange(rule, orderDate))
    .filter((rule) => matchCustomer(rule, customer) && matchProduct(rule, product))
    .sort((a, b) => specificity(b) - specificity(a))[0] || null;
}

export function calculateLineConditions({
  customer,
  product,
  payment,
  quantity = 1,
  orderDate = new Date().toISOString().slice(0, 10),
  discountMatrix = [],
  specialConditions = [],
  paymentRules = [],
}) {
  const productInfo = productData(product);
  const listPrice = parseMexalNumber(product?.prezzo_listino ?? product?.prezzo ?? productInfo?.prezzo_listino, 0);
  const priceRule = bestRule(specialConditions, "P", customer, product, orderDate);
  const discountRule = bestRule(specialConditions, "S", customer, product, orderDate);
  const specialPrice = priceRule ? parseMexalNumber(ruleValue(priceRule), NaN) : NaN;
  const basePrice = Number.isFinite(specialPrice) && specialPrice > 0 ? specialPrice : listPrice;

  const matrix = discountMatrix.find((item) =>
    Number(item.cod_cat_cli) === customerCategory(customer) &&
    Number(item.cod_cat_art) === productDiscountCategory(product)
  );

  const commercialChain = discountRule
    ? ruleValue(discountRule)
    : text(matrix?.sconto_esteso || matrix?.sconto || "");

  const paymentCode = text(payment?.codice || payment?.codice_pagamento || customer?.codice_pagamento);
  const paymentRule = paymentRules.find((item) =>
    text(item.codice_pagamento) === paymentCode &&
    (!item.data_inizio || inDateRange(item, orderDate))
  );
  const paymentChain = text(paymentRule?.sconto_esteso || paymentRule?.sconto || payment?.sconto || "");

  const netUnit = applyDiscountChain(applyDiscountChain(basePrice, commercialChain), paymentChain);
  const equivalent = equivalentDiscount(commercialChain, paymentChain);

  return {
    prezzo_listino: listPrice,
    prezzo_base: Number(basePrice.toFixed(4)),
    prezzo_netto: Number(netUnit.toFixed(4)),
    totale_riga: Number((netUnit * Number(quantity || 0)).toFixed(4)),
    sconto_commerciale: commercialChain,
    sconto_pagamento: paymentChain,
    sconto_percentuale: equivalent,
    origine_prezzo: priceRule ? "particolarita-prezzo" : "listino",
    origine_sconto: discountRule ? "particolarita-sconto" : matrix ? "matrice-sconti" : "nessuno",
    regola_prezzo: priceRule,
    regola_sconto: discountRule,
  };
}

function text(value) {
  return String(value ?? "").trim();
}

function integer(value, fallback = 0) {
  const parsed = Number.parseInt(text(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstPositiveInteger(values, fallback = 0) {
  for (const value of values) {
    const parsed = integer(value, 0);
    if (parsed > 0) return parsed;
  }
  return fallback;
}

function firstPositiveIntegerDeep(source, keys, fallback = 0) {
  if (!source || typeof source !== "object") return fallback;

  const direct = firstPositiveInteger(keys.map((key) => source?.[key]), 0);
  if (direct > 0) return direct;

  for (const value of Object.values(source)) {
    if (!value || typeof value !== "object") continue;
    const nested = firstPositiveIntegerDeep(value, keys, 0);
    if (nested > 0) return nested;
  }

  return fallback;
}

function decodeCompactDiscount(value) {
  const raw = text(value).replace(/[^0-9-]/g, "");
  if (!raw || raw.startsWith("-")) return "";

  // Mexal può restituire 5035 per indicare 50+35.
  if (/^\d{4}$/.test(raw)) {
    const first = Number(raw.slice(0, 2));
    const second = Number(raw.slice(2, 4));
    if (first < 100 && second < 100) return `${first}+${second}`;
  }

  // Supporto prudente a tre sconti concatenati, ad esempio 503505.
  if (/^\d{6}$/.test(raw)) {
    const parts = [raw.slice(0, 2), raw.slice(2, 4), raw.slice(4, 6)].map(Number);
    if (parts.every((item) => item < 100)) return parts.join("+");
  }

  return "";
}

export function parseMexalNumber(value, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  const raw = text(value);
  if (!raw) return fallback;

  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseDiscountChain(value) {
  return text(value)
    .replace(/%/g, "")
    .split(/[+;/]/)
    .map((item) => parseMexalNumber(item, NaN))
    .filter(
      (item) =>
        Number.isFinite(item) &&
        item > -100 &&
        item < 100
    );
}

export function normalizeDiscountChain(value) {
  const parsed = parseDiscountChain(value);
  if (parsed.length) return parsed.map((item) => String(item)).join("+");
  return decodeCompactDiscount(value);
}

export function applyDiscountChain(amount, chain) {
  return parseDiscountChain(chain).reduce(
    (current, discount) => current * (1 - discount / 100),
    Number(amount || 0)
  );
}

export function equivalentDiscount(...chains) {
  const finalAmount = chains.reduce(
    (amount, chain) => applyDiscountChain(amount, chain),
    100
  );

  return Number((100 - finalAmount).toFixed(4));
}

function mergedRow(row) {
  if (!row || typeof row !== "object") return {};

  const raw =
    row.dati_mexal && typeof row.dati_mexal === "object"
      ? row.dati_mexal
      : row.json_mexal && typeof row.json_mexal === "object"
        ? row.json_mexal
        : {};

  return { ...raw, ...row };
}

function customerData(customer) {
  return mergedRow(customer);
}

function productData(product) {
  return mergedRow(product);
}

function customerCategory(customer) {
  const data = customerData(customer);
  const keys = [
    "categoria_sconti",
    "categoria_sconto_cliente",
    "categoria_sconto",
    "cod_cat_sconti",
    "cod_cat_sconto",
    "id_cat_sconto",
    "codice_categoria_sconti",
    "cat_sconti",
  ];

  return firstPositiveInteger([
    customer?.categoria_sconti,
    customer?.categoria_sconto_cliente,
    customer?.categoria_sconto,
    customer?.cod_cat_sconti,
    customer?.cod_cat_sconto,
    customer?.id_cat_sconto,
    firstPositiveIntegerDeep(data, keys, 0),
  ]);
}

function customerStatCategory(customer) {
  const data = customerData(customer);

  return firstPositiveInteger([
    customer?.categoria_statistica_cliente,
    customer?.id_catsta_conto,
    customer?.nr_cat_sta,
    data.categoria_statistica_cliente,
    data.id_catsta_conto,
    data.nr_cat_sta,
  ]);
}

function productDiscountCategory(product) {
  const data = productData(product);
  const keys = [
    "categoria_sconto",
    "categoria_sconto_articolo",
    "id_cat_sconto",
    "cod_cat_sconto",
    "codice_categoria_sconto",
    "cat_sconto",
  ];

  return firstPositiveInteger([
    product?.categoria_sconto,
    product?.categoria_sconto_articolo,
    product?.id_cat_sconto,
    product?.cod_cat_sconto,
    firstPositiveIntegerDeep(data, keys, 0),
  ]);
}

function productStatCategory(product) {
  const data = productData(product);

  return firstPositiveInteger([
    product?.categoria_statistica_articolo,
    product?.nr_cat_sta,
    data.categoria_statistica_articolo,
    data.nr_cat_sta,
  ]);
}

function productNature(product) {
  const data = productData(product);

  return text(
    product?.natura_articolo ??
      product?.cod_natura ??
      data.natura_articolo ??
      data.cod_natura
  );
}

function productGroup(product) {
  const data = productData(product);

  return text(
    product?.gruppo_merceologico ??
      product?.cod_grp_merc ??
      data.gruppo_merceologico ??
      data.cod_grp_merc
  );
}

function dateKey(value) {
  const raw = text(value);
  if (!raw) return "";

  const onlyDigits = raw.replace(/[^0-9]/g, "");

  if (onlyDigits.length >= 8) {
    if (/^\d{4}/.test(onlyDigits)) {
      return onlyDigits.slice(0, 8);
    }

    const day = onlyDigits.slice(0, 2);
    const month = onlyDigits.slice(2, 4);
    const year = onlyDigits.slice(4, 8);
    return `${year}${month}${day}`;
  }

  return onlyDigits;
}

function inDateRange(rule, date) {
  const current = dateKey(date);
  const start = dateKey(rule.data_inizio);
  const end = dateKey(rule.data_fine);

  return (!start || current >= start) && (!end || current <= end);
}

function isActive(rule) {
  return rule?.is_active !== false;
}

function matchCustomer(rule, customer) {
  const type = text(rule.tp_dato_conto).toUpperCase();

  if (type === "C") {
    return (
      text(rule.codice_conto) ===
      text(customer?.codice_cliente ?? customerData(customer).codice_cliente)
    );
  }

  if (type === "N") {
    return integer(rule.id_cat_conto) === customerCategory(customer);
  }

  if (type === "S") {
    return integer(rule.id_catsta_conto) === customerStatCategory(customer);
  }

  return false;
}

function matchProduct(rule, product) {
  const type = text(rule.tp_dato_art).toUpperCase();

  const code = text(
    product?.codice_articolo ??
      product?.codice_mexal ??
      product?.codice ??
      productData(product).codice_articolo ??
      productData(product).codice_mexal ??
      productData(product).codice
  );

  if (type === "A") {
    return text(rule.cod_articolo) === code;
  }

  if (type === "T") {
    return integer(rule.id_cat_art) === productDiscountCategory(product);
  }

  if (type === "M") {
    const ruleGroup = text(rule.cod_grp_merc);
    const group = productGroup(product);

    return Boolean(
      ruleGroup &&
        group &&
        (group === ruleGroup || group.startsWith(ruleGroup))
    );
  }

  if (type === "E") {
    return integer(rule.nr_catsta_art) === productStatCategory(product);
  }

  if (type === "U") {
    return text(rule.cod_natura) === productNature(product);
  }

  return false;
}

function specificity(rule) {
  const customerScores = {
    C: 300,
    N: 200,
    S: 100,
  };

  const productScores = {
    A: 50,
    T: 40,
    M: 30,
    E: 20,
    U: 10,
  };

  return (
    (customerScores[text(rule.tp_dato_conto).toUpperCase()] || 0) +
    (productScores[text(rule.tp_dato_art).toUpperCase()] || 0) +
    integer(rule.priority_override, 0)
  );
}

function firstRuleValue(entries) {
  if (!Array.isArray(entries)) return "";

  for (const entry of entries) {
    if (Array.isArray(entry)) {
      const candidate = text(entry[1] ?? entry[0]);
      if (candidate) return candidate;
      continue;
    }

    if (entry && typeof entry === "object") {
      const candidate = text(
        entry.valore ??
          entry.value ??
          entry.sconto ??
          entry.prezzo
      );

      if (candidate) return candidate;
      continue;
    }

    const candidate = text(entry);
    if (candidate) return candidate;
  }

  return "";
}

function ruleValue(rule) {
  return (
    firstRuleValue(rule.part_1) ||
    firstRuleValue(rule.part_2) ||
    text(rule.sconto_esteso) ||
    text(rule.sconto) ||
    text(rule.prezzo)
  );
}

function bestRule(rules, type, customer, product, orderDate) {
  return (
    (rules || [])
      .map(mergedRow)
      .filter(isActive)
      .filter(
        (rule) =>
          text(rule.tipo_part).toUpperCase() === type
      )
      .filter((rule) => inDateRange(rule, orderDate))
      .filter(
        (rule) =>
          matchCustomer(rule, customer) &&
          matchProduct(rule, product)
      )
      .sort((a, b) => specificity(b) - specificity(a))[0] || null
  );
}

function resolveListPrice(product, customer) {
  const data = productData(product);

  const listCode = text(
    customer?.codice_listino ??
      customerData(customer).codice_listino ??
      "1"
  );

  const possibleLists =
    data.prz_listino ??
    data.prezzi_listino ??
    data.listini;

  if (Array.isArray(possibleLists)) {
    const entry = possibleLists.find((item) => {
      if (Array.isArray(item)) {
        return text(item[0]) === listCode;
      }

      return (
        text(
          item?.codice ??
            item?.listino ??
            item?.id
        ) === listCode
      );
    });

    if (entry) {
      const value = Array.isArray(entry)
        ? entry[1]
        : entry.prezzo ??
          entry.valore ??
          entry.importo;

      const parsed = parseMexalNumber(value, NaN);

      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  return parseMexalNumber(
    product?.prezzo_listino ??
      product?.prezzo ??
      data.prezzo_listino ??
      data.prezzo,
    0
  );
}

function paymentCode(payment, customer) {
  const code = text(
    payment?.codice ??
      payment?.codice_pagamento ??
      customer?.codice_pagamento ??
      customerData(customer).codice_pagamento
  );
  return /^0*\d+$/.test(code) ? String(Number(code)) : code;
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
  const listPrice = resolveListPrice(product, customer);

  const priceRule = bestRule(
    specialConditions,
    "P",
    customer,
    product,
    orderDate
  );

  const discountRule = bestRule(
    specialConditions,
    "S",
    customer,
    product,
    orderDate
  );

  const specialPrice = priceRule
    ? parseMexalNumber(ruleValue(priceRule), NaN)
    : NaN;

  const basePrice =
    Number.isFinite(specialPrice) && specialPrice > 0
      ? specialPrice
      : listPrice;

  const customerDiscountCategory = customerCategory(customer);
  const articleDiscountCategory = productDiscountCategory(product);

  const matrix =
    (discountMatrix || [])
      .map(mergedRow)
      .filter(isActive)
      .find(
        (item) =>
          integer(item.cod_cat_cli) === customerDiscountCategory &&
          integer(item.cod_cat_art) === articleDiscountCategory
      ) || null;

  // Priorità commerciale:
  // 1) particolarità prezzo: prezzo fisso, la matrice non si applica;
  // 2) particolarità sconto: sostituisce la matrice;
  // 3) matrice sconti;
  // 4) sconto pagamento, applicato sempre dopo la condizione commerciale.
  const commercialChain = normalizeDiscountChain(
    discountRule
      ? ruleValue(discountRule)
      : priceRule
        ? ""
        : matrix?.sconto_esteso ??
            matrix?.sconto ??
            ""
  );

  const code = paymentCode(payment, customer);

  const paymentRule =
    (paymentRules || [])
      .map(mergedRow)
      .filter(isActive)
      .filter(
        (item) =>
          paymentCode(item, {}) === code
      )
      .filter((item) => inDateRange(item, orderDate))
      .sort(
        (a, b) =>
          integer(b.priority, 0) -
          integer(a.priority, 0)
      )[0] || null;

  const paymentChain = normalizeDiscountChain(
    paymentRule?.sconto_esteso ??
      paymentRule?.sconto ??
      payment?.sconto ??
      ""
  );

  const afterCommercial = applyDiscountChain(
    basePrice,
    commercialChain
  );

  const netUnit = applyDiscountChain(
    afterCommercial,
    paymentChain
  );

  const equivalent = equivalentDiscount(
    commercialChain,
    paymentChain
  );

  const safeQuantity = Math.max(
    0,
    parseMexalNumber(quantity, 0)
  );

  return {
    prezzo_listino: Number(listPrice.toFixed(4)),
    prezzo_base: Number(basePrice.toFixed(4)),
    prezzo_dopo_sconto_commerciale: Number(
      afterCommercial.toFixed(4)
    ),
    prezzo_netto: Number(netUnit.toFixed(4)),
    totale_riga: Number(
      (netUnit * safeQuantity).toFixed(4)
    ),
    sconto_commerciale: commercialChain,
    sconto_pagamento: paymentChain,
    sconto_percentuale: equivalent,
    origine_prezzo: priceRule
      ? "particolarita-prezzo"
      : "listino",
    origine_sconto: discountRule
      ? "particolarita-sconto"
      : matrix
        ? "matrice-sconti"
        : "nessuno",
    regola_prezzo_id: priceRule?.id ?? null,
    regola_sconto_id: discountRule?.id ?? null,
    regola_pagamento_id: paymentRule?.id ?? null,
    dettaglio_calcolo: {
      data_ordine: orderDate,
      codice_listino: text(
        customer?.codice_listino ??
          customerData(customer).codice_listino ??
          "1"
      ),
      categoria_sconto_cliente:
        customerDiscountCategory,
      categoria_sconto_articolo:
        articleDiscountCategory,
      codice_pagamento: code,
      prezzo_listino: Number(listPrice.toFixed(4)),
      prezzo_base: Number(basePrice.toFixed(4)),
      sconto_commerciale: commercialChain,
      sconto_pagamento: paymentChain,
      sconto_equivalente: equivalent,
      prezzo_netto: Number(netUnit.toFixed(4)),
      origine_prezzo: priceRule
        ? "particolarita-prezzo"
        : "listino",
      origine_sconto: discountRule
        ? "particolarita-sconto"
        : matrix
          ? "matrice-sconti"
          : "nessuno",
      matrice: matrix
        ? {
            cod_cat_cli: matrix.cod_cat_cli,
            cod_cat_art: matrix.cod_cat_art,
            sconto:
              matrix.sconto_esteso ??
              matrix.sconto ??
              "",
          }
        : null,
      priorita_applicata: priceRule
        ? "particolarita-prezzo"
        : discountRule
          ? "particolarita-sconto"
          : matrix
            ? "matrice-sconti"
            : "nessuna-condizione",
      descrizione_calcolo: priceRule
        ? `Prezzo speciale ${Number(basePrice.toFixed(4))}`
        : discountRule
          ? `Particolarità sconto ${commercialChain || "-"}`
          : matrix
            ? `Matrice ${commercialChain || "-"}`
            : "Nessuna condizione commerciale",
    },
    regola_prezzo: priceRule,
    regola_sconto: discountRule,
    regola_pagamento: paymentRule,
  };
}

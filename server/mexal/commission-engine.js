const text = (value) => String(value ?? "").trim();
const integer = (value) => {
  if (!text(value)) return null;
  const parsed = Number(text(value));
  return Number.isInteger(parsed) ? parsed : null;
};

export function productCommissionCategory(product = {}) {
  return integer(product.categoria_provvigionale_mexal ?? product.dati_mexal?.id_categoria_pr ?? product.json_mexal?.id_categoria_pr);
}

export function customerCommissionCategory(customer = {}) {
  return integer(customer.categoria_provvigionale_mexal ?? customer.dati_mexal?.cod_cat_pr ?? customer.json_mexal?.cod_cat_pr);
}

function commissionError({ customer, line, customerCategory, productCategory, agent, reason }) {
  const error = new Error(`Provvigione non calcolabile: cliente ${text(customer?.codice_cliente || customer?.codice || "sconosciuto")}, articolo ${text(line?.codice_articolo || "sconosciuto")}, categoria cliente ${customerCategory ?? "mancante"}, categoria prodotto ${productCategory ?? "mancante"}, agente ${agent || "mancante"}. ${reason}`);
  error.code = "MEXAL_COMMISSION_RULE_MISSING";
  error.status = 422;
  return error;
}

function activeOnDate(rule, now) {
  if (!rule?.attiva) return false;
  const date = new Date(now);
  return (!rule.valida_dal || new Date(rule.valida_dal) <= date) && (!rule.valida_al || new Date(rule.valida_al) >= date);
}

export function calculateCommissions({ order = {}, customer, lines = [], products = [], rules = [], now = new Date() }) {
  const byCode = new Map((products || []).map((product) => [text(product.codice_articolo || product.codice_mexal).toUpperCase(), product]));
  const customerCategory = customerCommissionCategory(customer);
  const agent = text(order.codice_agente_mexal || customer?.codice_agente_mexal || customer?.dati_mexal?.cod_agente);
  if (customerCategory === null) throw commissionError({ customer, line: lines[0], customerCategory, agent, reason: "Categoria provvigionale cliente assente." });
  return lines.map((line) => {
    const product = byCode.get(text(line.codice_articolo).toUpperCase()) || line.prodotto || {};
    const productCategory = productCommissionCategory(product);
    if (productCategory === null) throw commissionError({ customer, line, customerCategory, productCategory, agent, reason: "Categoria provvigionale prodotto assente." });
    const candidates = rules.filter((rule) => activeOnDate(rule, now) && integer(rule.categoria_cliente) === customerCategory && integer(rule.categoria_prodotto) === productCategory);
    const rule = candidates.find((item) => text(item.codice_agente_mexal) === agent && agent) || candidates.find((item) => !text(item.codice_agente_mexal));
    if (!rule) throw commissionError({ customer, line, customerCategory, productCategory, agent, reason: "Nessuna regola provvigionale attiva configurata." });
    const percentage = Number(rule.percentuale);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) throw commissionError({ customer, line, customerCategory, productCategory, agent, reason: "La percentuale della regola non è valida (deve essere tra 0 e 100)." });
    return {
      ...line, provvigione_percentuale: percentage, provvigione_regola_id: rule.id,
      provvigione_dettaglio_calcolo: { categoria_cliente: customerCategory, categoria_prodotto: productCategory, codice_agente_mexal: agent || null, regola_id: rule.id, origine: rule.origine || "mexal_regole_provvigioni" },
    };
  });
}

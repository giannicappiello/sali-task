const PLACEHOLDER_PATTERN = /\{([^{}]+)\}/g;

export const ORDER_EMAIL_PLACEHOLDERS = Object.freeze([
  "{cliente}",
  "{numero_ordine}",
  "{data}",
  "{agente}",
  "{totale}",
]);

export const ORDER_EMAIL_TEMPLATE_DEFAULTS = Object.freeze({
  email_cliente_oggetto_template: "Conferma ordine {numero_ordine}",
  email_cliente_corpo_template: "Gentile {cliente},\n\nin allegato trova la conferma dell'ordine {numero_ordine} del {data}, per un totale di {totale}.\n\nCordiali saluti.",
  email_agente_oggetto_template: "Conferma ordine {numero_ordine} - {cliente}",
  email_agente_corpo_template: "Ciao {agente},\n\nin allegato trovi la conferma dell'ordine {numero_ordine} del {data} per il cliente {cliente}, per un totale di {totale}.",
  email_backoffice_oggetto_template: "Ordine {numero_ordine} - {cliente}",
  email_backoffice_corpo_template: "È stato confermato l'ordine {numero_ordine} del {data} per il cliente {cliente}.\nAgente: {agente}\nTotale: {totale}.",
});

function text(value) {
  return String(value ?? "").trim();
}

function formatDate(value) {
  const raw = text(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw || "-";
}

function formatMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString("it-IT", { style: "currency", currency: "EUR" })
    : (0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function agentName(agent, order) {
  return [agent?.nome, agent?.cognome].map(text).filter(Boolean).join(" ")
    || text(order?.agente_nome)
    || text(order?.codice_agente_mexal)
    || "-";
}

export function orderEmailTemplateCategory(recipientType) {
  if (recipientType === "cliente") return "cliente";
  if (recipientType === "agente") return "agente";
  return "backoffice";
}

export function buildOrderEmailTemplateValues({ order, customer, agent } = {}) {
  return {
    cliente: text(order?.ragione_sociale_cliente)
      || text(customer?.ragione_sociale)
      || text(order?.codice_cliente)
      || "-",
    numero_ordine: text(order?.numero_ordine_visualizzato)
      || text(order?.numero_ordine)
      || text(order?.id)
      || "-",
    data: formatDate(order?.data_ordine),
    agente: agentName(agent, order),
    totale: formatMoney(order?.totale_documento ?? order?.totale),
  };
}

export function validateOrderEmailTemplate(template, {
  label = "Template email",
  maxLength = 10000,
} = {}) {
  const value = String(template ?? "").trim();
  if (!value) throw new Error(`${label} obbligatorio.`);
  if (value.length > maxLength) throw new Error(`${label} troppo lungo.`);

  const supported = new Set(ORDER_EMAIL_PLACEHOLDERS);
  const unknown = [...value.matchAll(PLACEHOLDER_PATTERN)]
    .map((match) => `{${match[1]}}`)
    .filter((placeholder) => !supported.has(placeholder));
  if (unknown.length) {
    throw new Error(`${label}: placeholder non supportati: ${[...new Set(unknown)].join(", ")}.`);
  }
  return value;
}

export function renderOrderEmailTemplate(template, values, options) {
  return validateOrderEmailTemplate(template, options).replace(
    PLACEHOLDER_PATTERN,
    (placeholder, name) => (
      Object.hasOwn(values || {}, name) ? String(values[name] ?? "") : placeholder
    ),
  );
}

export function resolveOrderEmailContent({
  moduleConfig,
  recipientType,
  values,
} = {}) {
  const category = orderEmailTemplateCategory(recipientType);
  const subjectKey = `email_${category}_oggetto_template`;
  const bodyKey = `email_${category}_corpo_template`;
  const subjectTemplate = moduleConfig?.[subjectKey]
    || ORDER_EMAIL_TEMPLATE_DEFAULTS[subjectKey];
  const bodyTemplate = moduleConfig?.[bodyKey]
    || ORDER_EMAIL_TEMPLATE_DEFAULTS[bodyKey];

  return {
    subject: renderOrderEmailTemplate(subjectTemplate, values, {
      label: `Oggetto email ${category}`,
      maxLength: 255,
    }),
    body: renderOrderEmailTemplate(bodyTemplate, values, {
      label: `Corpo email ${category}`,
      maxLength: 10000,
    }),
  };
}

export function orderEmailTemplateSnapshot(moduleConfig = {}) {
  return Object.fromEntries(
    Object.keys(ORDER_EMAIL_TEMPLATE_DEFAULTS).map((key) => [
      key,
      moduleConfig[key] || ORDER_EMAIL_TEMPLATE_DEFAULTS[key],
    ]),
  );
}

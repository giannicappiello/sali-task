const CUSTOMER_CODE = "501.00995";
const ARTICLE_PREFIX = "IT";
const WAREHOUSE_NUMBER = 5;
const MOVING_AVERAGE_MONTHS = 12;
const DEFAULT_LEAD_TIME_DAYS = 30;

const clean = (value) => String(value ?? "").trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const dateOnly = (value) => new Date(value).toISOString().slice(0, 10);
const addDays = (value, days) => {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const addMonths = (value, months) => {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date;
};

function productLeadTime(product, configured) {
  if (number(configured) > 0) return Math.trunc(number(configured));
  const payload = product?.dati_mexal && typeof product.dati_mexal === "object" ? product.dati_mexal : {};
  const candidate = payload.lead_time ?? payload.leadtime ?? payload.giorni_riordino ?? payload.gg_riordino;
  return number(candidate) > 0 ? Math.trunc(number(candidate)) : DEFAULT_LEAD_TIME_DAYS;
}

export function calculateSaliDiIschiaProposal({ products = [], sales = [], stocks = [], settings = [], now = new Date() } = {}) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const currentStart = addMonths(today, -MOVING_AVERAGE_MONTHS);
  const previousStart = addMonths(currentStart, -MOVING_AVERAGE_MONTHS);
  const settingsByArticle = new Map(settings.map((item) => [clean(item.article_code).toUpperCase(), item]));
  const stockByArticle = new Map(stocks.map((item) => [clean(item.article_code).toUpperCase(), number(item.available)]));
  const lines = [];

  for (const product of products) {
    const articleCode = clean(product.codice_articolo).toUpperCase();
    if (!articleCode.startsWith(ARTICLE_PREFIX)) continue;
    const setting = settingsByArticle.get(articleCode);
    if (setting?.enabled === false) continue;
    const matching = sales.filter((sale) => clean(sale.articleCode).toUpperCase() === articleCode);
    const currentQuantity = matching.filter((sale) => new Date(sale.date) >= currentStart).reduce((sum, sale) => sum + number(sale.quantity), 0);
    const previousQuantity = matching.filter((sale) => new Date(sale.date) >= previousStart && new Date(sale.date) < currentStart)
      .reduce((sum, sale) => sum + number(sale.quantity), 0);
    const currentMonthlyAverage = currentQuantity / MOVING_AVERAGE_MONTHS;
    const previousMonthlyAverage = previousQuantity / MOVING_AVERAGE_MONTHS;
    const estimatedMonthlyConsumption = Math.max(currentMonthlyAverage, previousMonthlyAverage);
    if (estimatedMonthlyConsumption <= 0) continue;
    const leadTimeDays = productLeadTime(product, setting?.lead_time_days);
    const replenishmentRequirement = estimatedMonthlyConsumption * leadTimeDays / 30;
    const availableStock = stockByArticle.get(articleCode) || 0;
    const proposedQuantity = Math.ceil(Math.max(0, replenishmentRequirement - availableStock));
    if (proposedQuantity <= 0) continue;
    lines.push({
      articleCode,
      description: clean(product.descrizione),
      unitOfMeasure: clean(product.unita_misura) || "PZ",
      currentMonthlyAverage,
      previousMonthlyAverage,
      estimatedMonthlyConsumption,
      availableStock,
      leadTimeDays,
      replenishmentRequirement,
      proposedQuantity,
      requiredAt: addDays(today, leadTimeDays),
    });
  }

  return {
    proposalDate: dateOnly(today), customerCode: CUSTOMER_CODE, warehouseNumber: WAREHOUSE_NUMBER,
    currentPeriodStart: dateOnly(currentStart), previousPeriodStart: dateOnly(previousStart),
    currentPeriodEnd: dateOnly(today), calculationVersion: 1, lines,
  };
}

async function loadProposalInput(admin, now) {
  const currentStart = addMonths(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), -MOVING_AVERAGE_MONTHS);
  const previousStart = dateOnly(addMonths(currentStart, -MOVING_AVERAGE_MONTHS));
  const [productsResult, stocksResult, settingsResult, invoicesResult] = await Promise.all([
    admin.from("ordini_prodotti_cache").select("codice_articolo,descrizione,unita_misura,dati_mexal").ilike("codice_articolo", `${ARTICLE_PREFIX}%`),
    admin.from("workspace_warehouse_stock").select("article_code,available").eq("warehouse_number", WAREHOUSE_NUMBER).eq("is_current", true).ilike("article_code", `${ARTICLE_PREFIX}%`),
    admin.from("workspace_sali_replenishment_article_settings").select("article_code,lead_time_days,enabled"),
    admin.from("mexal_fatture_vendita").select("id,data_documento,mexal_fatture_vendita_righe(codice_articolo,quantita)")
      .eq("codice_cliente", CUSTOMER_CODE).gte("data_documento", previousStart).lt("data_documento", dateOnly(now)),
  ]);
  const error = productsResult.error || stocksResult.error || settingsResult.error || invoicesResult.error;
  if (error) throw error;
  const sales = (invoicesResult.data || []).flatMap((invoice) => (invoice.mexal_fatture_vendita_righe || []).map((line) => ({
    articleCode: line.codice_articolo, quantity: line.quantita, date: invoice.data_documento,
  })));
  return { products: productsResult.data || [], stocks: stocksResult.data || [], settings: settingsResult.data || [], sales };
}

export async function generateSaliDiIschiaProposal({ admin, actor, now = new Date() }) {
  const input = await loadProposalInput(admin, now);
  const proposal = calculateSaliDiIschiaProposal({ ...input, now });
  if (!proposal.lines.length) return { created: false, proposal: null, message: "Nessuna proposta Sali di Ischia da creare con i dati Workspace disponibili." };
  const { data, error } = await admin.rpc("create_workspace_sali_replenishment_proposal", {
    p_proposal_date: proposal.proposalDate,
    p_customer_code: proposal.customerCode,
    p_warehouse_number: proposal.warehouseNumber,
    p_previous_period_start: proposal.previousPeriodStart,
    p_current_period_start: proposal.currentPeriodStart,
    p_current_period_end: proposal.currentPeriodEnd,
    p_calculation_version: proposal.calculationVersion,
    p_actor: actor || "workspace:service",
    p_lines: proposal.lines,
  });
  if (error) throw error;
  const row = data?.[0] || null;
  return {
    created: row?.was_created === true,
    proposal: row,
    message: row?.was_created === true
      ? `Proposta Sali di Ischia creata in Workspace: ${proposal.lines.length} righe.`
      : "La proposta Sali di Ischia di oggi esiste già in Workspace.",
  };
}

export async function listSaliDiIschiaProposals(admin) {
  const [headersResult, linesResult] = await Promise.all([
    admin.from("workspace_sali_replenishment_proposals").select("*").order("proposal_date", { ascending: false }).limit(30),
    admin.from("workspace_sali_replenishment_proposal_lines").select("*").order("article_code").limit(1000),
  ]);
  const error = headersResult.error || linesResult.error;
  if (error) throw error;
  const linesByProposal = new Map();
  for (const line of linesResult.data || []) linesByProposal.set(line.proposal_id, [...(linesByProposal.get(line.proposal_id) || []), line]);
  return (headersResult.data || []).map((proposal) => ({ ...proposal, lines: linesByProposal.get(proposal.id) || [] }));
}

export const SALI_DI_ISCHIA_RULES = Object.freeze({
  customerCode: CUSTOMER_CODE, articlePrefix: ARTICLE_PREFIX, warehouseNumber: WAREHOUSE_NUMBER,
  movingAverageMonths: MOVING_AVERAGE_MONTHS, defaultLeadTimeDays: DEFAULT_LEAD_TIME_DAYS,
});

import { randomUUID } from "node:crypto";
import process from "node:process";
import { HMAC_HEADERS, signProductionMessage } from "./progremes-production-hmac.js";

const SOURCE_PATH = "/api/workspace/v1/purchase-requirements-source";
const ACTION_PATH = "/api/workspace/v4/purchasing/actions";
const clean = (value) => String(value ?? "").trim();

function configuration(options = {}) {
  const baseUrl = clean(options.progremesUrl ?? process.env.PROGREMES_URL).replace(/\/+$/, "");
  const secret = clean(options.secret ?? process.env.PROGREMES_INTEGRATION_SECRET);
  if (!baseUrl || !secret) throw Object.assign(new Error("Integrazione ProgreMES non configurata."), { code: "MISSING_CONFIGURATION", status: 500 });
  return { baseUrl, secret, fetchFn: options.fetchFn ?? fetch };
}

function validateSource(payload) {
  if (!payload || Number(payload.contractVersion) !== 4 || !Array.isArray(payload.demands) ||
      !Array.isArray(payload.stocks) || !Array.isArray(payload.arrivals) || !Array.isArray(payload.existingPf))
    throw Object.assign(new Error("Sorgente fabbisogni ProgreMES non valida."), { code: "INVALID_MES_RESPONSE", status: 502 });
  return payload;
}

async function parse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw Object.assign(new Error(payload?.error || payload?.message || `ProgreMES HTTP ${response.status}.`), {
      code: payload?.code || "PROGREMES_PURCHASING_FAILED", status: response.status >= 500 ? 502 : response.status,
    });
  }
  return payload;
}

export async function readWorkspaceV4PurchasingSource(options = {}) {
  const { baseUrl, secret, fetchFn } = configuration(options);
  const response = await fetchFn(`${baseUrl}${SOURCE_PATH}`, {
    headers: { Accept: "application/json", "X-Workspace-Secret": secret }, redirect: "error",
  });
  return validateSource(await parse(response));
}

export async function executeWorkspaceV4PurchasingAction(command, options = {}) {
  const { baseUrl, secret, fetchFn } = configuration(options);
  const body = JSON.stringify({ contractVersion: 4, ...command });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const eventId = clean(command.eventId) || randomUUID();
  const signature = signProductionMessage({ method: "POST", path: ACTION_PATH, timestamp, eventId, body, secret });
  const response = await fetchFn(`${baseUrl}${ACTION_PATH}`, {
    method: "POST", redirect: "error", body,
    headers: { Accept: "application/json", "Content-Type": "application/json",
      [HMAC_HEADERS.timestamp]: timestamp, [HMAC_HEADERS.eventId]: eventId, [HMAC_HEADERS.signature]: signature },
  });
  return parse(response);
}

export function automaticPfRows(requirements, options = {}) {
  const generatedAt = new Date(options.generatedAt || Date.now());
  const horizonDays = Number.isFinite(Number(options.horizonDays)) ? Number(options.horizonDays) : 60;
  if (Number.isNaN(generatedAt.getTime()) || horizonDays < 1) return [];
  const start = Date.UTC(generatedAt.getUTCFullYear(), generatedAt.getUTCMonth(), generatedAt.getUTCDate());
  const end = start + horizonDays * 86_400_000;
  const seen = new Set();
  return (requirements || []).filter((row) => {
    const required = day(row.requiredAt);
    const key = `${Number(row.articleId)}:${monthKey(row.requiredAt)}`;
    if (!Number.isFinite(required) || required < start || required > end || number(row.quantityToOrder) <= 0) return false;
    if (clean(row.pfDocuments) || number(row.pfQuantity) > 0 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function automaticPfLines(requirements, options = {}) {
  return automaticPfRows(requirements, options).map((row) => ({
    articleId: Number(row.articleId),
    quantity: number(row.quantityToOrder),
    requiredAt: row.requiredAt,
  }));
}

export function selectedPfRows(requirements) {
  const seen = new Set();
  return (requirements || []).filter((row) => {
    const key = `${Number(row.articleId)}:${monthKey(row.requiredAt)}`;
    if (number(row.quantityToOrder) <= 0) return false;
    if (clean(row.pfDocuments) || number(row.pfQuantity) > 0 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const monthKey = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};
const day = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

export function calculateWorkspaceV4PurchaseRequirements(source) {
  validateSource(source);
  const stock = new Map(source.stocks.map((item) => [Number(item.articleId), number(item.availableQuantity)]));
  const arrivalsByArticle = new Map();
  for (const arrival of source.arrivals) {
    const articleId = Number(arrival.articleId);
    arrivalsByArticle.set(articleId, [...(arrivalsByArticle.get(articleId) || []), { ...arrival, residualQuantity: number(arrival.residualQuantity) }]);
  }
  for (const arrivals of arrivalsByArticle.values()) arrivals.sort((a, b) => day(a.expectedAt) - day(b.expectedAt));
  const demandsByArticle = new Map();
  for (const demand of source.demands) {
    const articleId = Number(demand.articleId);
    demandsByArticle.set(articleId, [...(demandsByArticle.get(articleId) || []), { ...demand, quantity: number(demand.quantity) }]);
  }

  const rows = [];
  for (const [articleId, demands] of demandsByArticle) {
    demands.sort((a, b) => day(a.requiredAt) - day(b.requiredAt) || number(b.priority) - number(a.priority));
    const first = demands[0];
    const arrivals = arrivalsByArticle.get(articleId) || [];
    const allIncoming = arrivals.reduce((total, item) => total + item.residualQuantity, 0);
    let balance = stock.get(articleId) || 0;
    // Gli OF aperti rappresentano quantita gia ordinate anche quando la consegna
    // prevista e successiva alla necessita. Il saldo temporale segnala il ritardo;
    // questo saldo separato impedisce invece di proporre un secondo PF duplicato.
    let orderedBalance = balance + allIncoming;
    let arrivalIndex = 0;
    const byMonth = new Map();
    for (const demand of demands) {
      const key = monthKey(demand.requiredAt);
      if (key) byMonth.set(key, [...(byMonth.get(key) || []), demand]);
    }
    for (const [key, monthDemands] of [...byMonth].sort(([a], [b]) => a.localeCompare(b))) {
      const [year, month] = key.split("-").map(Number);
      const monthStart = Date.UTC(year, month - 1, 1);
      const monthEnd = Date.UTC(year, month, 1) - 1;
      while (arrivalIndex < arrivals.length && day(arrivals[arrivalIndex].expectedAt) < monthStart) balance += arrivals[arrivalIndex++].residualQuantity;
      const openingStock = Math.max(0, balance);
      let minimum = balance;
      let minimumOrdered = orderedBalance;
      let shortageAt = null;
      monthDemands.sort((a, b) => day(a.requiredAt) - day(b.requiredAt) || number(b.priority) - number(a.priority));
      for (const demand of monthDemands) {
        while (arrivalIndex < arrivals.length && day(arrivals[arrivalIndex].expectedAt) <= day(demand.requiredAt)) balance += arrivals[arrivalIndex++].residualQuantity;
        balance -= demand.quantity;
        orderedBalance -= demand.quantity;
        if (balance < minimum) { minimum = balance; if (balance < 0 && !shortageAt) shortageAt = demand.requiredAt; }
        if (orderedBalance < minimumOrdered) minimumOrdered = orderedBalance;
      }
      while (arrivalIndex < arrivals.length && day(arrivals[arrivalIndex].expectedAt) <= monthEnd) balance += arrivals[arrivalIndex++].residualQuantity;
      const netRequirement = Math.max(0, -minimumOrdered);
      const reorderLot = number(first.reorderLot);
      const quantityToOrder = netRequirement > 0 && reorderLot > 0 ? Math.ceil(netRequirement / reorderLot) * reorderLot : netRequirement;
      balance += quantityToOrder;
      orderedBalance += quantityToOrder;
      const monthArrivals = arrivals.filter((arrival) => monthKey(arrival.expectedAt) === key);
      const suggested = monthArrivals[0] || arrivals[0] || null;
      const pf = source.existingPf.filter((item) => Number(item.articleId) === articleId && monthKey(item.expectedAt) === key);
      const requiredAt = shortageAt || monthDemands[0].requiredAt;
      const orderBy = new Date(day(requiredAt) - number(first.leadTimeDays) * 86_400_000).toISOString();
      rows.push({ key: `${articleId}:${key}`, month: `${key}-01T00:00:00.000Z`, articleId,
        articleCode: first.articleCode, description: first.description, unitOfMeasure: first.unitOfMeasure,
        articleType: first.articleType, requiredAt, orderBy, leadTimeDays: number(first.leadTimeDays),
        requiredQuantity: monthDemands.reduce((total, item) => total + item.quantity, 0), availableStock: openingStock,
        incomingQuantity: allIncoming, netRequirement, quantityToOrder, reorderLot,
        supplierId: suggested?.supplierId ?? null, supplierName: suggested?.supplierName || "",
        supplierOrders: [...new Set(arrivals.map((item) => `${item.supplierOrderNumber} (${new Date(item.expectedAt).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })})`))].join(", "),
        productionOrders: [...new Set(monthDemands.map((item) => item.productionOrderNumber))].slice(0, 4).join(", "),
        octReferences: [...new Set(monthDemands.map((item) => clean(item.octReferences)).filter(Boolean))].join(", "),
        pfQuantity: pf.reduce((total, item) => total + number(item.quantity), 0), pfDocuments: [...new Set(pf.map((item) => item.documentNumber))].join(", "),
        status: quantityToOrder > 0
          ? (day(orderBy) < day(new Date()) ? "ORDER_LATE" : "TO_ORDER")
          : shortageAt && allIncoming > 0
            ? "ORDER_LATE"
            : allIncoming > 0 ? "COVERED_BY_ARRIVALS" : "COVERED_BY_STOCK" } );
    }
  }
  return rows.sort((a, b) => Number(b.quantityToOrder > 0) - Number(a.quantityToOrder > 0) || day(a.requiredAt) - day(b.requiredAt) || a.articleCode.localeCompare(b.articleCode));
}

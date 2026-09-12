// CRM-only reads. The primary client MUST carry the caller JWT (RLS).
export function boundedDays(value) {
  return Number.isFinite(value) ? Math.min(180, Math.max(1, Math.trunc(value))) : 30;
}
export function addDays(date, days) {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function normalizePeriod(period = {}) {
  if (!period.from && !period.to) return null;
  const valid = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  if (!valid(period.from) || !valid(period.to) || period.from > period.to) throw new Error("Periodo BeautyDays non valido.");
  return { from: period.from, to: period.to };
}
export async function readAllRows(makeQuery, pageSize = 500) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const result = await makeQuery().range(offset, offset + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if ((result.data || []).length < pageSize) return rows;
  }
}
async function readForKeys(keys, makeQuery) {
  const rows = [];
  const unique = [...new Set(keys.filter(Boolean))];
  // Bound IN filters; always paginate to avoid silent API row limits.
  for (let offset = 0; offset < unique.length; offset += 100) {
    const chunk = unique.slice(offset, offset + 100);
    rows.push(...await readAllRows(() => makeQuery(chunk)));
  }
  return rows;
}
export function sumDocuments(rows) {
  const unique = [...new Map(rows.map(row => [row.id, row])).values()];
  return unique.reduce((cents, row) => cents + Math.round(Number(row.totale_documento || 0) * 100), 0) / 100;
}
export function eventImpact(event, code, commercial, postDays) {
  const to = addDays(event.data, postDays);
  const orders = event.stato === "eseguita" ? commercial.orders.filter(row =>
    row.codice_cliente === code && row.data_ordine > event.data && row.data_ordine <= to) : [];
  // Preserve invoice information for the existing individual customer panel.
  const invoices = commercial.invoices.filter(row => row.codice_cliente === code && row.data_documento >= event.data && row.data_documento <= to);
  return {
    post_days: postDays, order_count: orders.length, order_value: sumDocuments(orders),
    orders: orders.map(row => ({ id: row.id, value: Number(row.totale_documento || 0) })),
    invoice_count: invoices.length, invoice_value: sumDocuments(invoices),
  };
}
async function loadCommercialImpact(primary, customerCodes, days, postDays, period) {
  if (!days.length) return { orders: [], invoices: [] };
  const dates = days.map(row => row.data).sort();
  const from = [dates[0], period?.from].filter(Boolean).sort()[0];
  const to = [addDays(dates.at(-1), postDays), period?.to].filter(Boolean).sort().at(-1);
  const [orders, invoices] = await Promise.all([
    readForKeys(customerCodes, codes => primary.from("crm_order_kpi_source")
      .select("id,codice_cliente,data_ordine,totale_documento").in("codice_cliente", codes)
      .gte("data_ordine", from).lte("data_ordine", to).order("id")),
    readForKeys(customerCodes, codes => primary.from("mexal_fatture_vendita")
      .select("id,codice_cliente,data_documento,totale_documento").in("codice_cliente", codes)
      .gte("data_documento", from).lte("data_documento", to).order("id")),
  ]);
  return { orders, invoices };
}
export async function loadCrmBeautyRows(primary, report, customerCode, requestedPostDays, requestedPeriod = {}) {
  const postDays = boundedDays(requestedPostDays);
  const period = normalizePeriod(requestedPeriod);
  const mappingRows = await readAllRows(() => {
    let query = primary.from("beauty_clienti_mexal").select("codice_cliente,beauty_external_id,legacy_farmacia_id")
      .order("codice_cliente").order("legacy_farmacia_id").order("beauty_external_id");
    if (customerCode) query = query.eq("codice_cliente", customerCode);
    return query;
  });
  const mappings = mappingRows.filter(row => row.legacy_farmacia_id);
  if (!mappings.length) return { linked: false, post_days: postDays, period, events: [] };
  const farmToCustomer = new Map(mappings.map(row => [row.legacy_farmacia_id, row.codice_cliente]));
  const days = await readForKeys([...farmToCustomer.keys()], ids => {
    let query = report.from("giornate_promozionali").select("*").in("farmacia_id", ids);
    if (period) query = query.gte("data", period.from).lte("data", period.to);
    return query.order("data", { ascending: false }).order("id");
  });
  days.sort((a,b) => b.data.localeCompare(a.data) || String(a.id).localeCompare(String(b.id)));
  const codes = [...new Set(days.map(row => farmToCustomer.get(row.farmacia_id)))];
  const [sales, consultants, clients, pharmacies, commercial] = await Promise.all([
    readForKeys(days.map(row => row.id), ids => report.from("vendite_prodotti").select("*").in("giornata_id", ids).order("id")),
    readForKeys(days.map(row => row.consultant_id), ids => report.from("beauty_consultant").select("id,nome,cognome").in("id", ids).order("id")),
    readForKeys(codes, ids => primary.from("mexal_clienti_cache").select("codice_cliente,ragione_sociale").in("codice_cliente", ids).order("codice_cliente")),
    readForKeys(days.map(row => row.farmacia_id), ids => report.from("farmacie").select("id,nome").in("id", ids).order("id")),
    loadCommercialImpact(primary, codes, days, postDays, period),
  ]);
  const consultantNames = new Map(consultants.map(row => [row.id, [row.nome,row.cognome].filter(Boolean).join(" ")]));
  const customerNames = new Map(clients.map(row => [row.codice_cliente, row.ragione_sociale?.trim()]));
  const pharmacyNames = new Map(pharmacies.map(row => [row.id, row.nome?.trim()]));
  const salesByDay = new Map();
  for (const sale of sales) salesByDay.set(sale.giornata_id, [...(salesByDay.get(sale.giornata_id) || []), sale]);
  const periodTotals = new Map(codes.map(code => [code, period ? sumDocuments(commercial.orders.filter(row =>
    row.codice_cliente === code && row.data_ordine >= period.from && row.data_ordine <= period.to)) : null]));
  const events = days.map(day => {
    const code = farmToCustomer.get(day.farmacia_id);
    return { ...day, customer_code: code,
      customer_name: customerNames.get(code) || pharmacyNames.get(day.farmacia_id) || "Farmacia non disponibile",
      consultant_name: consultantNames.get(day.consultant_id) || null,
      sales: salesByDay.get(day.id) || [], period_order_value: periodTotals.get(code),
      impact: eventImpact(day, code, commercial, postDays) };
  });
  return { linked: true, post_days: postDays, period, events };
}
export async function loadCrmBeautyCustomer(primary, report, customerCode, postDays) {
  if (!customerCode) throw new Error("Codice cliente obbligatorio");
  return loadCrmBeautyRows(primary, report, customerCode, postDays);
}
export async function loadCrmBeautyDashboard(primary, report, postDays, period = {}) {
  const result = await loadCrmBeautyRows(primary, report, null, postDays, period);
  const executed = result.events.filter(row => row.stato === "eseguita");
  const uniqueOrders = new Map(executed.flatMap(row => row.impact.orders).map(row => [row.id,row]));
  return { ...result, metrics: {
    linked_customers: new Set(result.events.map(row => row.customer_code)).size,
    total_events: result.events.length, executed_events: executed.length,
    planned_events: result.events.filter(row => row.stato === "pianificata").length,
    reported_revenue: executed.reduce((sum,row) => sum + Number(row.fatturato_giornata || 0),0),
    reported_units: executed.reduce((sum,row) => sum + Number(row.numero_totale_pezzi_venduti || 0),0),
    post_event_invoice_value: executed.reduce((sum,row) => sum + row.impact.invoice_value,0),
    post_event_order_value: [...uniqueOrders.values()].reduce((sum,row) => sum + Math.round(row.value * 100),0) / 100,
  }};
}

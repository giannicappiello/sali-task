const labels = { Production: 'Preparazione', Packaging: 'Confezionamento', Cartoning: 'Confezionamento' };

// All PC stations use authenticated MES pages; the local Raspberry UI is independent.
export function stationPanelUrl(operationType, resourceCode) {
  if (operationType !== 'Production') return '';
  const code = String(resourceCode || '').trim().toUpperCase();
  const match = /^(?:ST|STATION)\s*0*(\d+)$/.exec(code);
  if (!match || Number(match[1]) < 1 || code.length > 30) return '';
  return `/produzione/progremes.PlanningProduction?destination=station&station=${encodeURIComponent(code)}&workspaceMesWindow=1`;
}

export function stationActionUrl(activity, operation) {
  const base = stationPanelUrl(activity.operationType, activity.resourceCode);
  const orderId = Number(activity.productionOrderId);
  if (!base || !['start', 'close'].includes(operation) || !Number.isSafeInteger(orderId) || orderId <= 0 || orderId > 2147483647) return '';
  return `${base}&stationAction=${operation}&orderId=${orderId}`;
}

// MES serializes local plant times without an offset. Preserve their wall time;
// convert explicitly zoned timestamps to the plant timezone instead of device time.
export function plantTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value)) return String(value).slice(0, 16);
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
  return parts.replace(' ', 'T');
}

export function productionActivities(rows) {
  return rows.flatMap((row, index) => {
    const start = plantTime(row.start), end = plantTime(row.end);
    if (!start || !end || end <= start || !labels[row.operationType]) return [];
    return [{
      id: `mes-${row.productionOrderId}-${row.operationType}-${start}-${index}`,
      productionOrderId: row.productionOrderId,
      operationType: row.operationType,
      tipo: 'production', titolo: `${row.orderNumber} · ${row.articleCode}`,
      ...(Array.isArray(row.workingIntervals) ? { workingIntervals: row.workingIntervals.map(i => ({ start: plantTime(i.start), end: plantTime(i.end) })) } : {}),
      descrizione: row.articleDescription, start, end, deadline: end.slice(0, 10),
      stato: row.status, reparto: labels[row.operationType],
      resource: row.resource || '', forecast: row.forecast === true,
      resourceCode: row.resourceCode || '', orderNumber: row.orderNumber || '', articleCode: row.articleCode || '',
      customerName: row.customerName || '', rdpReference: row.rdpReference || '', octReference: row.octReference || '',
      panelUrl: stationPanelUrl(row.operationType, row.resourceCode || String(row.resource || '').split(' · ')[0]),
    }];
  });
}

export function activityInMonth(item, year, month) {
  const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const next = new Date(year, month + 1, 1);
  const after = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
  return item.tipo === 'production' ? item.start < `${after}T00:00` && item.end > `${first}T00:00`
    : String(item.deadline || '').slice(0, 10) >= first && String(item.deadline || '').slice(0, 10) < after;
}

export function activityOnDay(item, day) {
  if (item.tipo !== 'production') return String(item.deadline || '').slice(0, 10) === day;
  if (Array.isArray(item.workingIntervals)) return item.workingIntervals.some(i => i.start < `${day}T24:00` && i.end > `${day}T00:00`);
  return item.start < `${day}T24:00` && item.end > `${day}T00:00`;
}

const labels = { Production: 'Preparazione', Packaging: 'Confezionamento', Cartoning: 'Confezionamento' };

// Same operational Station destinations configured in the MES planner.
const stationHosts = { 1: '179:1880/ui', 2: '58:1880/ui', 3: '41:1880/ui', 4: '200:1880/ui', 5: '165:1880/ui', 6: '97:1880/ui', 7: '217', 8: '210:1880/ui', 9: '172:1880/ui', 10: '205:1880/ui' };
export function stationPanelUrl(operationType, resourceCode) {
  if (operationType !== 'Production') return '';
  const match = /^(?:ST|STATION)\s*0*(\d+)$/i.exec(String(resourceCode || '').trim());
  return match && stationHosts[Number(match[1])] ? `http://10.64.0.${stationHosts[Number(match[1])]}` : '';
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
  return item.start < `${day}T24:00` && item.end > `${day}T00:00`;
}

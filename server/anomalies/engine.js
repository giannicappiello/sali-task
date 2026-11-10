import { createHash } from 'node:crypto';

export const POLICY = Object.freeze({ version: 'fabbisogni-v1', timezone: 'Europe/Rome', time: '07:00', days: 28 });
export function businessWindow(now = new Date()) {
 const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: POLICY.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
 const from = `${parts.year}-${parts.month}-${parts.day}`;
 const shift = n => new Date(Date.parse(from + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
 return { from, toExclusive: shift(28), yesterday: shift(-1), due: parts.hour === '07' && parts.minute === '00' };
}
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite = x => typeof x === 'number' && Number.isFinite(x);
const key = x => JSON.stringify([x.warehouse, x.article, x.unit, x.lot]);
const instant = x => typeof x === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(x) && Number.isFinite(Date.parse(x));

// Physical stock is compared only when all source semantics are attested.
// Missing lot/UM/timestamp/coverage is an evidence gap, never a stock error.
export function reconcileStock(rows, { tolerance = 0.000001, maxSkewMs = 60000 } = {}) {
 const groups = new Map(), results = [];
 for (const row of rows) {
  if (!['mexal', 'mes', 'workspace'].includes(row.source)) throw Error('UNKNOWN_STOCK_SOURCE');
  if (!row.warehouse || !row.article || !row.unit || row.lot === undefined || !instant(row.capturedAt) || !instant(row.syncedThrough) || row.basis !== 'physical' || row.complete !== true || !finite(row.onHand)) {
   results.push({ classification: 'not_comparable', article: row.article, reason: 'Missing verified dimensions, physical basis, complete coverage or zoned synchronization timestamp' }); continue;
  }
  const list = groups.get(key(row)) || []; list.push(row); groups.set(key(row), list);
 }
 for (const [dimensions, group] of groups) {
  const bySource = new Set(group.map(x => x.source));
  if (group.length !== 3 || bySource.size !== 3) { results.push({ dimensions: JSON.parse(dimensions), classification: 'not_comparable', reason: 'Three unique source snapshots required' }); continue; }
  const times = group.flatMap(x => [Date.parse(x.capturedAt), Date.parse(x.syncedThrough)]);
  if (Math.max(...times) - Math.min(...times) > maxSkewMs) { results.push({ dimensions: JSON.parse(dimensions), classification: 'sync_pending' }); continue; }
  const delta = Math.max(...group.map(x => x.onHand)) - Math.min(...group.map(x => x.onHand));
  results.push({ dimensions: JSON.parse(dimensions), classification: delta <= tolerance ? 'aligned' : 'physical_difference_to_investigate', delta, sources: group });
 }
 return results;
}
export function reconcileMovements(rows) {
 const groups = new Map(), results = [];
 for (const row of rows) {
  if (!row.canonicalEventId || !['mexal','mes','workspace'].includes(row.source) || !row.article || !row.unit || !row.warehouse || row.lot === undefined || !finite(row.signedQuantity) || !instant(row.eventAt) || !instant(row.syncedThrough) || row.complete !== true || row.basis !== 'physical') {
   results.push({ classification: 'not_comparable', reason: 'Movement identity, sign, dimensions or synchronization coverage unverified' }); continue;
  }
  const group = groups.get(row.canonicalEventId) || []; group.push(row); groups.set(row.canonicalEventId, group);
 }
 for (const [id, group] of groups) {
  if (group.length !== 3 || new Set(group.map(x => x.source)).size !== 3) { results.push({ id, classification: 'not_comparable', reason: 'Canonical movement not covered by three unique sources' }); continue; }
  if (group.some(x => Date.parse(x.syncedThrough) < Math.max(...group.map(r => Date.parse(r.eventAt))))) { results.push({ id, classification: 'sync_pending' }); continue; }
  const same = group.every(x => key(x) === key(group[0]) && Math.abs(x.signedQuantity - group[0].signedQuantity) <= 0.000001 && Date.parse(x.eventAt) === Date.parse(group[0].eventAt));
  results.push({ id, classification: same ? 'aligned' : 'physical_difference_to_investigate', sources: group });
 }
 return results;
}

// Adapter contract: quantities are normalized to the material UM, reservations
// exclude demands in this snapshot, and incoming quantities are unreceived balances.
export function evaluatePlanning(snapshot, now = new Date()) {
 const window = businessWindow(now), findings = [], gaps = [], materialBalance = new Map(), purchaseAllocated = new Map();
 const add = (category, severity, identity, title, evidence, departmentId = null) => findings.push({
  agent_code: 'fabbisogni', fingerprint: hash([POLICY.version, category, identity]), category, severity, title,
  description: title, department_id: departmentId, source_modules: ['progremes', 'magazzino'], evidence,
 });
 const required = ['planning', 'bom', 'stock', 'requirements', 'purchaseOrders', 'receipts', 'quality', 'capacity', 'movements'];
 for (const source of required) if (snapshot.coverage?.[source]?.complete !== true) gaps.push({ source, reason: snapshot.coverage?.[source]?.reason || 'Complete, authorized snapshot unavailable' });
 const safe = name => snapshot.coverage?.[name]?.complete === true;
 if (!safe('planning')) return { window, status: 'incomplete', findings, gaps, reconciliation: [] };
 const jobs = (snapshot.jobs || []).filter(x => x.day >= window.from && x.day < window.toExclusive && !['cancelled', 'complete'].includes(x.status)).toSorted((a, b) => a.day.localeCompare(b.day) || String(a.id).localeCompare(String(b.id)));
 const incomingUsed = new Set();
 for (const job of jobs) {
  if (!safe('bom')) continue;
  if (!Array.isArray(job.materials) || !job.materials.length || job.bomVerified !== true) { add('bom', 'high', job.id, 'Formula/BOM mancante o non verificata', { jobId: job.id }, job.departmentId); continue; }
  for (const material of job.materials) {
   const identity = [job.id, material.warehouse, material.article, material.unit, material.lot ?? null];
   if (!finite(material.quantity) || material.quantity <= 0 || !material.unit || !material.warehouse || !material.article) { gaps.push({ source: 'bom', jobId: job.id, reason: 'Material quantity or normalized UM missing' }); continue; }
   const balanceKey = key(material);
   const stock = (snapshot.stock || []).find(x => key(x) === balanceKey && x.source === 'mexal' && x.basis === 'physical' && x.complete === true && instant(x.capturedAt));
   if (safe('quality') && stock?.qualityReleased === false) add('quality_block','high',identity,'Materiale o lotto non rilasciato dalla qualità',{ jobId:job.id,article:material.article,lot:material.lot ?? null },job.departmentId);
   if (!safe('stock') || !safe('quality') || !safe('purchaseOrders') || !stock || Date.parse(now) - Date.parse(stock.capturedAt) > 21600000 || Date.parse(stock.capturedAt) > Date.parse(now) + 60000 || !finite(stock.onHand) || !finite(stock.reservedOutsideHorizon) || stock.reservedOutsideHorizon < 0 || stock.qualityReleased !== true) {
    gaps.push({ source: 'availability', jobId: job.id, article: material.article, reason: 'Physical stock, quality, external reservations or purchase coverage unverified' }); continue;
   }
   if (!materialBalance.has(balanceKey)) materialBalance.set(balanceKey, stock.onHand - stock.reservedOutsideHorizon);
   const orders = (snapshot.purchaseOrders || []).filter(x => key(x) === balanceKey && !x.cancelled && finite(x.remaining) && x.remaining > 0);
   for (const order of orders) {
    if (!order.deliveryDay) add('delivery_missing', 'warning', order.id, 'Data di consegna fornitore non inserita', { purchaseOrderId: order.id, article: material.article }, job.departmentId);
    else if (order.deliveryDay <= job.day && order.qualityReleasedOnArrival === true && !incomingUsed.has(order.id)) { materialBalance.set(balanceKey, materialBalance.get(balanceKey) + order.remaining); incomingUsed.add(order.id); }
   }
   const before = materialBalance.get(balanceKey), shortage = Math.max(0, material.quantity - Math.max(0,before));
   materialBalance.set(balanceKey, before - material.quantity);
   if (shortage > 0) {
    add('material_shortage', 'high', identity, 'Materiale insufficiente alla data pianificata', { jobId: job.id, article: material.article, unit: material.unit, required: material.quantity, availableBefore: before, shortage, day: job.day }, job.departmentId);
    if (safe('requirements') && !(snapshot.requirements || []).some(x => x.jobId === job.id && key(x) === balanceKey && finite(x.quantity) && x.quantity >= shortage)) add('requirement_missing', 'high', identity, 'Fabbisogno assente o parziale', { jobId: job.id, article: material.article, shortage }, job.departmentId);
    const coverage = Math.max(0,orders.filter(x=>!incomingUsed.has(x.id)).reduce((n, x) => n + x.remaining, 0)-(purchaseAllocated.get(balanceKey)||0));
    purchaseAllocated.set(balanceKey,(purchaseAllocated.get(balanceKey)||0)+shortage);
    if (coverage < shortage) add(coverage ? 'purchase_partial' : 'purchase_missing', 'high', identity, coverage ? 'Ordine fornitore parziale' : 'Ordine fornitore mancante', { jobId: job.id, shortage, ordered: coverage }, job.departmentId);
    if (orders.some(x => x.deliveryDay > job.day)) add('delivery_incompatible', 'high', identity, 'Consegna incompatibile con il planning', { jobId: job.id, day: job.day, orders: orders.map(x => ({ id: x.id, deliveryDay: x.deliveryDay })) }, job.departmentId);
   }
  }
 }
 if (safe('receipts') && safe('quality')) for (const receipt of snapshot.receipts || []) if (receipt.day === window.yesterday && receipt.qualityReleased !== true) add('receipt_quality', 'warning', receipt.id, 'Merce ricevuta ieri: qualità o lotto da verificare', { receiptId: receipt.id, article: receipt.article, lot: receipt.lot ?? null }, receipt.departmentId);
 if (safe('capacity')) for (const slot of snapshot.capacity || []) if (slot.day >= window.from && slot.day < window.toExclusive && finite(slot.requiredHours) && finite(slot.availableHours) && slot.requiredHours > slot.availableHours) add('capacity', 'high', [slot.resourceId, slot.day], 'Capacità insufficiente', slot, slot.departmentId);
 const affected = new Set(findings.filter(x => x.category === 'material_shortage').map(x => x.evidence.jobId));
 // Fixed point includes indirect downstream dependencies without infinite cycles.
 let changed = true;
 while (changed) { changed = false; for (const job of jobs) if (!affected.has(job.id) && (job.dependsOn || []).some(id => affected.has(id))) { affected.add(job.id); changed = true; add('cascade', 'warning', job.id, 'Rischio a cascata da lavorazione precedente', { jobId: job.id, dependsOn: job.dependsOn }, job.departmentId); } }
 const reconciliation = safe('stock') ? reconcileStock(snapshot.stock || []) : [];
 for (const entry of reconciliation) if (['not_comparable','sync_pending'].includes(entry.classification)) gaps.push({ source: 'stock_reconciliation', reason: entry.classification, dimensions: entry.dimensions });
 for (const entry of reconciliation) if (entry.classification === 'physical_difference_to_investigate') add('stock_reconciliation', 'warning', entry.dimensions, 'Differenza di giacenza fisica da approfondire', entry);
 const movements = safe('movements') ? reconcileMovements(snapshot.movements || []) : [];
 for (const entry of movements) if (['not_comparable','sync_pending'].includes(entry.classification)) gaps.push({ source: 'movements', reason: entry.classification, id: entry.id });
 for (const entry of movements) if (entry.classification === 'physical_difference_to_investigate') add('movement_reconciliation','warning',entry.id,'Movimento fisico non coerente tra le fonti',entry);
 return { window, status: gaps.length ? 'incomplete' : 'complete', findings, gaps, reconciliation, movements };
}

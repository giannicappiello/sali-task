/* global Buffer, process */
import { randomUUID } from 'node:crypto';
import { HMAC_HEADERS, signProductionMessage } from './progremes-production-hmac.js';

const types = { 0: 'Production', 3: 'Packaging', 7: 'Cartoning' };
const statuses = ['Pianificata', 'In lavorazione', 'Completata', 'In ritardo', 'Controllo qualità', 'Respinta', 'Bloccata'];

// This transport cannot simulate, confirm, release or otherwise change a plan.
export function createHrPlanReader({ base = process.env.PROGREMES_URL, secret = process.env.PROGREMES_INTEGRATION_SECRET, transport = fetch } = {}) {
  return async (operation, input = {}) => {
    if (!['state', 'get'].includes(operation)) throw new Error('Operazione di sola lettura richiesta.');
    if (!base || !secret) throw Object.assign(new Error('Collegamento MES non configurato.'), { status: 503 });
    const path = `/api/workspace/ai/planning/${operation}`;
    const body = Buffer.from(JSON.stringify({ ...(operation === 'get' ? { id: input.id } : {}), actor: 'workspace:hr-production-calendar' }));
    const timestamp = Math.floor(Date.now() / 1000), eventId = randomUUID();
    const response = await transport(new URL(path, base), { method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(25000), headers: {
      'Content-Type': 'application/json', [HMAC_HEADERS.timestamp]: String(timestamp), [HMAC_HEADERS.eventId]: eventId,
      [HMAC_HEADERS.signature]: signProductionMessage({ method: 'POST', path, timestamp, eventId, body, secret: secret.trim() }),
    } });
    if (!response.ok) throw Object.assign(new Error('Lettura piano MES non disponibile.'), { status: 502, upstreamStatus: response.status });
    return response.json();
  };
}

export function activePlanRows(state, version) {
  if (!Array.isArray(version?.snapshot?.tasks)) throw new Error('Versione del piano MES incompleta.');
  const resources = new Map((version.snapshot.resources || state.resources || []).map(row => [row.id, row]));
  const demands = new Map((state.demands || []).map(row => [row.productionOrderId ?? -row.id, row]));
  return version.snapshot.tasks.flatMap(task => {
    const operationType = types[task.type] || (Object.values(types).includes(task.type) ? task.type : null);
    const demand = demands.get(task.orderId);
    if (!operationType || ['CANCELLED', 'HISTORICAL'].includes(demand?.stage)) return [];
    const resource = resources.get(task.resourceId);
    const forecast = task.orderId < 0;
    return [{ productionOrderId: task.orderId, orderNumber: task.orderNumber || demand?.number || '',
      articleCode: task.articleCode || demand?.articleCode || '', articleDescription: task.description || demand?.description || '',
      operationType, start: task.start, end: task.end,
      status: forecast ? 'Previsione' : statuses[task.status] || String(task.status || 'Pianificata'),
      resource: resource ? [resource.code, resource.description].filter(Boolean).join(' · ') : '',
      resourceCode: resource?.code || '',
      forecast,
    }];
  });
}

export async function readActiveProductionPlan(read = createHrPlanReader(), legacy) {
  const state = await read('state');
  if (state.configuration?.active !== true) return { items: await legacy(), source: 'archivio', versionId: null };
  const id = state.configuration.activeVersionId;
  if (!id) return { items: [], source: 'piano-attivo', versionId: null };
  const version = await read('get', { id });
  if (version.id !== id || !['APPLIED', 'PREPARING', 'RECONCILIATION_REQUIRED'].includes(version.status)) throw new Error('Versione attiva MES non valida.');
  return { items: activePlanRows(state, version), source: 'piano-attivo', versionId: id };
}

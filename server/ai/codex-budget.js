/* global Buffer */
// Byte ceilings are conservative payload limits, not a promise about dollar cost.
export const CODEX_BUDGET_VERSION = 'bounded-context-v1';
export const CODEX_MAX_CALLS = 12;
export const CODEX_MAX_INITIAL_BYTES = 196608;
export const CODEX_MAX_RESULT_BYTES = 24576;
export const CODEX_MAX_RESULTS_BYTES = 98304;
export const payloadBytes = value => Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');

export function boundedHistory(history = []) {
  const kept = [];
  let bytes = 0;
  for (const message of [...history].reverse()) {
    const size = payloadBytes(message);
    if (bytes + size > 16000) break;
    kept.unshift(message);
    bytes += size;
  }
  return { messages: kept, omittedMessages: history.length - kept.length,
    note: 'Storico parziale. Recuperare riferimenti mancanti con gli strumenti memoria; non inventare conferme o dati omessi.' };
}

export function codexRequestContext(auth, screenContext) {
  return { user: { id: auth.profile.id, nome: auth.profile.nome, cognome: auth.profile.cognome },
    authorizedModules: auth.capabilities.allowed_modules || auth.access.modules || [],
    generatedAt: new Date().toISOString(), screenContext,
    note: 'Dati aziendali non precaricati. Leggere soltanto i record necessari con gli strumenti autorizzati. Le omissioni non indicano assenza di dati.' };
}

export function boundedPlanningState(state, { orderId, offset = 0, limit = 10 } = {}) {
  const result = {};
  const pagination = {};
  for (const [key, value] of Object.entries(state)) {
    if (!Array.isArray(value)) { result[key] = value; continue; }
    const filtered = orderId && ['demands', 'odls', 'releaseShortages'].includes(key)
      ? value.filter(row => Number(row.productionOrderId ?? row.orderId) === orderId) : value;
    result[key] = filtered.slice(offset, offset + limit).map(row => {
      if (key !== 'versions') return row;
      const { snapshot, ...metadata } = row;
      return { ...metadata, snapshotOmitted: Boolean(snapshot), detailTool: 'MES_PLAN_STATUS' };
    });
    pagination[key] = { total: filtered.length, returned: result[key].length,
      nextOffset: offset + limit < filtered.length ? offset + limit : null };
  }
  return { ...result, pagination, scope: orderId ? { orderId } : 'all',
    note: 'Vista paginata: righe omesse non sono assenti. Usare orderId e offset per approfondire; MES_PLAN_STATUS per i dettagli della versione.' };
}

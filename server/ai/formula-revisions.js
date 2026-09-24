/* global Buffer, process */
import { randomUUID } from 'node:crypto';
import { jsonSchema } from 'ai';
import { HMAC_HEADERS, signProductionMessage } from '../progremes-production-hmac.js';

export const formulaRevisionSchema = { type: 'object', additionalProperties: false, required: ['targetId', 'expectedHash', 'reason', 'changes'], properties: {
  targetId: { type: 'integer', minimum: 1 }, expectedHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, reason: { type: 'string', minLength: 5, maxLength: 450 },
  changes: { type: 'object', additionalProperties: false, minProperties: 1, properties: {
    tempoProduzione: { type: 'integer', minimum: 1, maximum: 100000, description: 'Durata in ORE, non minuti.' },
    tempoRaffreddamento: { type: 'integer', minimum: 0, maximum: 100000, description: 'Ore.' },
    tempoMaturazione: { type: 'integer', minimum: 0, maximum: 100000, description: 'Ore.' },
    tempoConfezionamento: { type: 'integer', minimum: 0, maximum: 100000, description: 'Minuti.' },
    istruzioniOperative: { type: 'string', maxLength: 4000 },
    componenti: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object', additionalProperties: false, required: ['id', 'percentuale'], properties: {
      id: { type: 'integer', minimum: 1 }, percentuale: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
    } } },
  } },
} };

export async function formulaCall(auth, operation, input = {}, transport = fetch) {
  return mesDomainCall(auth, 'formulas', operation, input, transport);
}

export async function mesDomainCall(auth, domain, operation, input = {}, transport = fetch) {
  if (!['formulas', 'lots', 'machines'].includes(domain) || !['lookup', 'read', 'preview', 'result', 'resources'].includes(operation)) throw new Error('Operazione MES non disponibile.');
  const { data, error } = await auth.scoped.rpc('company_mes_ai_can_write');
  if (error || data !== true) throw Object.assign(new Error('Permesso operativo MES richiesto.'), { status: 403 });
  const secret = String(process.env.PROGREMES_INTEGRATION_SECRET || '').trim();
  if (!secret || !process.env.PROGREMES_URL) throw new Error('Collegamento MES non configurato.');
  const path = `/api/workspace/ai/${domain}/${operation}`;
  const body = Buffer.from(JSON.stringify({ ...input, actor: `workspace:${auth.profile.id}` }));
  const timestamp = Math.floor(Date.now() / 1000), eventId = randomUUID();
  const response = await transport(new URL(path, process.env.PROGREMES_URL), { method: 'POST', body, signal: AbortSignal.timeout(20000), headers: {
    'Content-Type': 'application/json', [HMAC_HEADERS.timestamp]: String(timestamp), [HMAC_HEADERS.eventId]: eventId,
    [HMAC_HEADERS.signature]: signProductionMessage({ method: 'POST', path, timestamp, eventId, body, secret }),
  } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 404 ? 'Aggiornamento MES richiesto per questa operazione.' : result.error || `Lettura MES non riuscita (${response.status}).`);
  return result;
}

export function formulaReadTools(auth) {
  return {
    MES_RESOURCE_COSTS: { description: 'Legge gli impianti e il costo fisso di lavorazione, con hash da usare nella proposta di modifica. Non ricalcola documenti storici.',
      inputSchema: jsonSchema({ type: 'object', additionalProperties: false, properties: {} }), execute: () => formulaCall(auth, 'resources') },
    FORMULA_LOOKUP: { description: 'Trova ID delle versioni formula dal codice o nome, prima di leggere o proporre una revisione.',
      inputSchema: jsonSchema({ type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', minLength: 2, maxLength: 160 } } }), execute: input => formulaCall(auth, 'lookup', input) },
    FORMULA_READ: { description: 'Legge formula, componenti, fasi, istruzioni e durate con hash della revisione attuale. Le durate di produzione/raffreddamento/maturazione sono ORE; confezionamento MINUTI.',
      inputSchema: jsonSchema({ type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } }), execute: input => formulaCall(auth, 'read', input) },
  };
}

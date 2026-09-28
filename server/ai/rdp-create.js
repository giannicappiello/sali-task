import { jsonSchema } from 'ai';
import { createHash } from 'node:crypto';
import { requirePermission } from '../mexal/lib/auth.js';
import { buildProductionDemand, prepareProductionDemand } from '../production-netting.js';
import { createWorkspaceRdp } from '../workspace-rdp-create.js';

const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const rows = result => { if (result.error) throw result.error; return result.data || []; };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const rdpCreateSchema = { type: 'object', additionalProperties: false, required: ['targetId', 'reason'], properties: {
  targetId: { type: 'string', pattern: '^[1-9][0-9]*$', description: 'snapshotId restituito da RDP_CREATE_PREVIEW.' },
  reason: { type: 'string', minLength: 1, maxLength: 1000 },
} };

export async function authorizeRdpCreation(auth) {
  if (auth.capabilities?.internal_data !== true || auth.capabilities?.progremes !== true) throw fail('Creazione RdP non autorizzata nel perimetro AI.', 403);
  const { data, error } = await auth.scoped.rpc('company_mes_ai_can_write');
  if (error || data !== true) throw fail('Permessi AI/MES insufficienti.', 403);
  return requirePermission({ headers: { authorization: `Bearer ${auth.token}` } }, auth.admin, 'rdp.create');
}

export function demandFingerprint(demand) {
  return digest({ orders: demand.orders.map(o => ({ orderId: o.orderId, versionHash: o.versionHash })),
    items: demand.items.map(source => { const item = { ...source }; delete item.workspaceAvailabilityAuthoritative; delete item.nettingOwner; return item; }) });
}

export async function validateRdpSnapshot(auth, snapshotId, { authorize = authorizeRdpCreation, build = buildProductionDemand } = {}) {
  const actor = await authorize(auth);
  if (!/^[1-9][0-9]*$/.test(String(snapshotId))) throw fail('Anteprima RdP non valida.');
  const { data, error } = await auth.admin.from('workspace_production_demand_snapshots')
    .select('id,requested_by,captured_at,snapshot').eq('id', snapshotId).maybeSingle();
  if (error) throw error;
  if (!data || data.requested_by !== actor.authUserId) throw fail('Anteprima RdP non appartenente a questo utente.', 403);
  const age = Date.now() - Date.parse(data.captured_at);
  if (!Number.isFinite(age) || age < 0 || age > 30 * 60 * 1000) throw fail('Anteprima RdP scaduta: ricalcolarla.');
  const demand = data.snapshot;
  if (demand?.contractVersion !== 4 || !demand.items?.length) throw fail('Anteprima RdP incompleta.');
  const lineIds = demand.items.map(i => i.lineId);
  const current = await build({ admin: auth.admin, lineIds });
  if (demandFingerprint(current) !== demandFingerprint(demand)) throw fail('Ordine o righe modificati: ricalcolare l’anteprima prima di creare la RdP.');
  return { actor, lineIds, snapshot: data };
}

export async function lookupRdpOrder(auth, { reference }) {
  await authorizeRdpCreation(auth);
  const match = String(reference || '').trim().toUpperCase().match(/^(?:OC\/(\d+)\/)?(\d+)$/);
  if (!match) throw fail('Usare il riferimento OC/serie/numero, per esempio OC/2/261.', 400);
  let query = auth.admin.from('ordini_testate')
    .select('id,mexal_sigla,mexal_serie,mexal_numero,mexal_chiave,mexal_eliminato_il,data_ordine')
    .eq('origine', 'mexal_oct').eq('mexal_numero', Number(match[2]));
  if (match[1]) query = query.eq('mexal_serie', Number(match[1])).eq('mexal_sigla', 'OC');
  const orders = rows(await query.limit(21));
  if (orders.length > 20) throw fail('Riferimento ambiguo: specificare OC/serie/numero.', 400);
  if (!orders.length) return { orders: [], source: 'ordini_testate', changed: false };
  const ids = orders.map(o => o.id);
  const lines = rows(await auth.admin.from('ordini_righe')
    .select('id,ordine_id,mexal_posizione,codice_articolo,quantita,unita_misura_oct,mexal_attiva,riga_descrittiva').in('ordine_id', ids));
  const links = rows(await auth.admin.from('workspace_production_request_items').select('production_request_id,ordine_riga_id').in('ordine_id', ids));
  const primary = rows(await auth.admin.from('workspace_production_requests').select('id,rdp_number,ordine_id,workspace_status,stato').in('ordine_id', ids));
  const linked = links.length ? rows(await auth.admin.from('workspace_production_requests').select('id,rdp_number,ordine_id,workspace_status,stato').in('id', [...new Set(links.map(l => l.production_request_id))])) : [];
  const requests = [...new Map([...primary, ...linked].map(r => [r.id, r])).values()];
  return { orders, lines, requests, links, changed: false,
    guidance: 'Una RdP CANCELLED resta nello storico. Se l’OC è valido, usare RDP_CREATE_PREVIEW e RDP_CREATE per una nuova richiesta; una richiesta ancora attiva o un annullamento pendente impediscono duplicati. Non creare una nuova RdP solo per aggirare l’aggiunta a un OP.' };
}

export async function previewRdpCreation(auth, { lineIds }) {
  const actor = await authorizeRdpCreation(auth);
  if (!Array.isArray(lineIds) || !lineIds.length || lineIds.length > 100 || lineIds.some(id => !/^[0-9a-f-]{36}$/i.test(id))) throw fail('Selezionare da 1 a 100 righe OC verificate.', 400);
  const prepared = await prepareProductionDemand({ admin: auth.admin, lineIds, requestedBy: actor.authUserId, mode: 'preview' });
  const { error } = await auth.admin.rpc('check_ai_rdp_demand_available', { p_snapshot: prepared.demand });
  if (error) throw error;
  return { snapshotId: String(prepared.snapshot.id), demand: prepared.demand, createsProduction: false,
    changed: false, nextTool: 'RDP_CREATE', note: 'Anteprima commerciale pronta. RDP_CREATE propone la creazione; il calcolo MES verrà eseguito dopo la conferma. Nessun OP o lotto viene creato.' };
}

export async function proposeRdpCreation(auth, input) {
  if (!String(input.reason || '').trim() || String(input.reason).length > 1000) throw fail('Motivazione della creazione obbligatoria.', 400);
  const { snapshot } = await validateRdpSnapshot(auth, input.targetId);
  const { error } = await auth.admin.rpc('check_ai_rdp_demand_available', { p_snapshot: snapshot.snapshot });
  if (error) throw error;
  return { targetId: String(snapshot.id), reason: String(input.reason || '').trim(), evidence: {
    orders: snapshot.snapshot.orders, items: snapshot.snapshot.items, productionCreated: false,
  } };
}

export async function executeRdpCreation(auth, pending) {
  const { actor, lineIds, snapshot } = await validateRdpSnapshot(auth, pending.payload_summary.targetId);
  const result = await createWorkspaceRdp({ admin: auth.admin, lineIds, snapshotId: pending.payload_summary.targetId,
    requestedBy: actor.authUserId, recordRpc: 'record_ai_workspace_production_demand',
    validateDemand: current => {
      if (demandFingerprint(current) !== demandFingerprint(snapshot.snapshot)) throw fail('Ordine cambiato durante la creazione: ricalcolare l’anteprima.');
    } });
  const request = rows(await auth.admin.from('workspace_production_requests')
    .select('id,rdp_number,workspace_status,stato').eq('id', result.requestId))[0];
  if (!request) throw fail('RdP creata ma lettura finale non disponibile: verificare lo storico prima di ripetere.');
  return { ...result, rdpNumber: request.rdp_number, applied: true, changed: true };
}

export function rdpCreationTools(auth, enabled) {
  if (!enabled || auth.capabilities?.internal_data !== true) return {};
  return {
    RDP_ORDER_LOOKUP: { description: 'Trova OC esatto e righe commerciali, RdP attive e annullate anche senza OP. Prima di creare una RdP leggere questo strumento: MES_PLAN_STATE da solo non basta. Numero semplice può essere ambiguo.',
      inputSchema: jsonSchema({ type: 'object', additionalProperties: false, required: ['reference'], properties: { reference: { type: 'string' } } }), execute: input => lookupRdpOrder(auth, input) },
    RDP_CREATE_PREVIEW: { description: 'Verifica righe OC e prepara creazione di una nuova RdP, anche dopo una precedente RdP annullata. Usa lineIds di RDP_ORDER_LOOKUP, preserva prodotti, quantità e riferimenti OC; non ripristina lo storico e non crea OP. Poi proporre RDP_CREATE con snapshotId come targetId.',
      inputSchema: jsonSchema({ type: 'object', additionalProperties: false, required: ['lineIds'], properties: { lineIds: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', format: 'uuid' } } } }), execute: input => previewRdpCreation(auth, input) },
  };
}

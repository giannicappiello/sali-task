import { jsonSchema } from 'ai';
import { mesDomainCall } from './formula-revisions.js';
import { authorizeStart, productionStartPreview } from './production-start.js';

export const PRODUCTION_EMERGENCY_PERMISSIONS = Object.freeze({
  MES_PRODUCTION_FORCE_CLOSE: 'progremes.production.force_close',
  MES_PRODUCTION_FORCE_START: 'progremes.production.force_start',
  MES_PRODUCTION_REOPEN: 'progremes.production.reopen',
});
const fail = (message, status = 403) => Object.assign(new Error(message), { status });
export function hasEmergencyPermission(auth, tool) {
  const code = PRODUCTION_EMERGENCY_PERMISSIONS[tool];
  return !code || (Array.isArray(auth.productionPermissions) && auth.productionPermissions.includes(code));
}
export async function readProductionPermissions(auth) {
  const { data, error } = await auth.scoped.rpc('workspace_mes_production_permissions');
  if (error || !Array.isArray(data)) throw fail('Permessi specifici MES non verificabili: aggiornare Workspace e riprovare.');
  return data.filter(code => Object.values(PRODUCTION_EMERGENCY_PERMISSIONS).includes(code));
}
export async function assertEmergencyPermission(auth, tool) {
  if (!(await readProductionPermissions(auth)).includes(PRODUCTION_EMERGENCY_PERMISSIONS[tool]))
    throw fail('Permesso specifico richiesto per questa operazione MES. Il ruolo amministratore non lo sostituisce.');
}
export const anomalyProperties = {
  anomalyType: { type: 'string', enum: ['meccanica', 'elettrica', 'dosaggio_peso', 'materiale', 'qualita', 'software', 'altro'] },
  anomalyDescription: { type: 'string', minLength: 5, maxLength: 1000 },
  reason: { type: 'string', minLength: 5, maxLength: 1000 },
};
export function assertAnomaly(input) {
  if (!anomalyProperties.anomalyType.enum.includes(input.anomalyType) ||
      ![input.anomalyDescription, input.reason].every(value => typeof value === 'string' && value.trim().length >= 5 && value.length <= 1000))
    throw fail('Indicare tipo, descrizione dell’anomalia e motivazione (5–1000 caratteri).', 400);
}
export const reopenSchema = { type: 'object', additionalProperties: false,
  required: ['targetId', 'expectedHash', ...Object.keys(anomalyProperties)], properties: {
    targetId: { type: 'integer', minimum: 1, maximum: 2147483647 },
    expectedHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, ...anomalyProperties,
  } };
export async function reopenCall(auth, operation, input = {}, transport) {
  await assertEmergencyPermission(auth, 'MES_PRODUCTION_REOPEN');
  return mesDomainCall(auth, 'production-reopen', operation, input, transport);
}
export async function previewReopen(auth, input) {
  assertAnomaly(input);
  const state = await reopenCall(auth, 'preview', { targetId: input.targetId });
  if (state.expectedHash !== input.expectedHash || state.targetId !== input.targetId)
    throw fail('Lavorazione o dipendenze cambiate: rileggere l’anteprima.', 409);
  if (state.canReopen !== true) throw fail((state.blockers || ['Riapertura non consentita.']).join(' '), 409);
  return state;
}
export async function verifyForcedClosure(auth, input) {
  await assertEmergencyPermission(auth, 'MES_PRODUCTION_FORCE_CLOSE');
  const state = await mesDomainCall(auth, 'production-closure', 'preview', { targetId: input.productionId });
  if (state.productionId !== input.productionId || state.mexalVerified !== true)
    throw fail(state.message || 'Registrazioni SL/CL non verificate in Mexal: nessuna chiusura forzata.', 409);
  return state;
}
export async function previewForcedStart(auth, input) {
  await assertEmergencyPermission(auth, 'MES_PRODUCTION_FORCE_START');
  assertAnomaly(input);
  await authorizeStart(auth, input.kind);
  const state = await productionStartPreview(auth, input);
  // Only the existing MES shortage exception is supported. Every other start
  // prerequisite (lot, quality, machine, sequence and printing) stays in MES.
  if (input.kind !== 'production') throw fail('L’avvio con carenze è previsto solo per la miscelazione.', 409);
  return { ...state, allowShortage: true, anomalyType: input.anomalyType,
    anomalyDescription: input.anomalyDescription, reason: input.reason,
    effect: 'Avvio con carenze esplicitamente autorizzate, tramite stampa centralizzata e controlli MES esistenti. Nessun bypass di qualità, lotto, impianto o sequenza.' };
}
export function productionEmergencyTools(auth) {
  return {
    MES_PRODUCTION_PERMISSIONS: { effect: 'read', description: 'Legge i propri permessi specifici di chiusura forzata, avvio forzato e riapertura. Admin e livello AI non li concedono.',
      inputSchema: jsonSchema({ type: 'object', additionalProperties: false, properties: {} }), execute: () => readProductionPermissions(auth) },
    ...(hasEmergencyPermission(auth, 'MES_PRODUCTION_FORCE_CLOSE') ? {
      MES_PRODUCTION_FORCE_CLOSE_PREVIEW: { effect: 'read', description: 'Verifica in sola lettura i documenti effettivi SL/CL in Mexal prima della chiusura forzata. Il flag dell’utente non sostituisce questa prova.',
        inputSchema: jsonSchema({ type: 'object', additionalProperties: false, required: ['targetId'], properties: { targetId: reopenSchema.properties.targetId } }),
        execute: input => mesDomainCall(auth, 'production-closure', 'preview', input) },
    } : {}),
    ...(hasEmergencyPermission(auth, 'MES_PRODUCTION_REOPEN') ? {
      MES_PRODUCTION_REOPEN_PREVIEW: { effect: 'read', description: 'Verifica in sola lettura una lavorazione conclusa prima della riapertura. Riporta hash, documenti, dipendenze e blocchi. Non annulla SL/CL né movimenti.',
        inputSchema: jsonSchema({ type: 'object', additionalProperties: false, required: ['targetId'], properties: { targetId: reopenSchema.properties.targetId } }),
        execute: input => reopenCall(auth, 'preview', input) },
    } : {}),
  };
}

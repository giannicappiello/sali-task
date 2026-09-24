import { jsonSchema } from 'ai';
import { mesDomainCall } from './formula-revisions.js';

export const lotConfirmationSchema = { type: 'object', additionalProperties: false, required: ['targetId', 'previewToken'], properties: {
  targetId: { type: 'integer', minimum: 1 }, previewToken: { type: 'string', minLength: 20, maxLength: 16000 },
} };
export const lotCall = (auth, operation, input) => mesDomainCall(auth, 'lots', operation, input);
export function assertLotPreview(input, current) {
  if (current.orderId !== input.targetId || current.state !== 'NOT_APPLIED' || current.applied !== false) throw new Error('Anteprima lotto diversa o già gestita. Verificare l’esito prima di ripetere.');
  if (!Number.isFinite(Date.parse(current.expiresAt)) || Date.parse(current.expiresAt) <= Date.now()) throw new Error('Anteprima lotto scaduta. Ripetere la verifica.');
  return { ...input, evidence: current };
}
export function lotReadTools(auth) {
  return {
    LOT_LOOKUP: { description: 'Cerca OP/RdP, articolo e lotto effettivo prima di proporre una modifica MES/Mexal.',
      inputSchema: jsonSchema({ type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', minLength: 2, maxLength: 160 } } }), execute: input => lotCall(auth, 'lookup', input) },
    LOT_PREVIEW: { description: 'Verifica una modifica, aggiunta o eliminazione del lotto tramite il servizio MES esistente, incluse verifiche Mexal e OP collegati. Non scrive. Mostrare tutti i collegamenti e conseguenze prima della conferma LOT_OVERRIDE.',
      inputSchema: jsonSchema({ type: 'object', additionalProperties: false, required: ['orderId', 'action', 'lotCode', 'reason'], properties: {
        orderId: { type: 'integer', minimum: 1 }, action: { type: 'string', enum: ['Aggiungi', 'Modifica', 'Elimina'] },
        lotCode: { type: 'string', maxLength: 30 }, reason: { type: 'string', minLength: 5, maxLength: 300 },
      } }), execute: input => lotCall(auth, 'preview', input) },
  };
}

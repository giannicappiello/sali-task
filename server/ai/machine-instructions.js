import { jsonSchema } from 'ai';
import { mesDomainCall } from './formula-revisions.js';
export const machineDraftSchema = { type: 'object', additionalProperties: false, required: ['targetId', 'station', 'expectedHash', 'reason', 'steps'], properties: {
  targetId: { type: 'integer', minimum: 1 }, station: { type: 'string', minLength: 1, maxLength: 80 }, expectedHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  reason: { type: 'string', minLength: 5, maxLength: 500 }, steps: { type: 'array', minItems: 1, maxItems: 100, items: {
    type: 'object', additionalProperties: false, required: ['stepId', 'order', 'phase', 'device', 'action', 'completion', 'timeoutSeconds', 'stopPolicy', 'message'], properties: {
      stepId: { type: 'string', format: 'uuid' }, order: { type: 'integer', minimum: 1 }, phase: { type: 'string', minLength: 1, maxLength: 10 },
      device: { type: 'string', description: 'Identificativo esatto del dispositivo restituito dal profilo macchina, mai inventarlo.' },
      action: { type: 'string', enum: ['RUN', 'STOP', 'DOSE', 'CONFIRM_INGREDIENT', 'CONFIRM', 'WAIT'] },
      completion: { type: 'string', enum: ['elapsed', 'stopped', 'quantity', 'operator'] },
      speedPct: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: 100 }, durationSeconds: { type: ['integer', 'null'], minimum: 1 },
      timeoutSeconds: { type: 'integer', minimum: 1, maximum: 86400 }, stopPolicy: { type: 'string', const: 'STOP_ALL' },
      ingredientId: { type: ['integer', 'null'], minimum: 1 }, sharePct: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: 100 }, message: { type: 'string', maxLength: 500 },
    },
  } },
} };
export const machineCall = (auth, operation, input) => mesDomainCall(auth, 'machines', operation, input);
export function machineReadTools(auth) {
  return { MACHINE_INSTRUCTION_CONTEXT: {
    description: 'Legge il profilo effettivo della Station e la formula approvata. Necessario per preparare una bozza di istruzioni macchina; non invia comandi al PLC.',
    inputSchema: jsonSchema({ type: 'object', additionalProperties: false, required: ['id', 'station'], properties: { id: { type: 'integer', minimum: 1 }, station: { type: 'string', minLength: 1, maxLength: 80 } } }),
    execute: input => machineCall(auth, 'read', input),
  } };
}

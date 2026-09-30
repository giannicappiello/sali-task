import { operationalPrintId, requireCentralPrint } from './operational-print.js';
import { randomUUID } from 'node:crypto';
import { createProgremesProductionClient } from './progremes-production-client.js';
import { productionSheetSession } from './production-sheet-access.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function preparationInput(body) {
  const productionOrderId = Number(body.productionOrderId), operation = body.operation;
  if (!Number.isSafeInteger(productionOrderId) || productionOrderId <= 0 || productionOrderId > 2147483647 ||
      !['context', 'sheet', 'print', 'start'].includes(operation)) throw fail('Operazione di preparazione non valida.');
  const input = { productionOrderId, operation };
  if (operation === 'start') {
    input.resourceCode = String(body.resourceCode || '').trim();
    if (!input.resourceCode || input.resourceCode.length > 100) throw fail('Impianto non disponibile.');
  }
  if (operation === 'print') {
    input.externalId = operationalPrintId(body);
    input.printMode = 'server';
    input.contentHash = String(body.contentHash || '');
    if (!/^[a-f0-9]{64}$/i.test(input.contentHash)) throw fail('Riapri l’anteprima del foglio prima di stampare.');
  }
  return input;
}
export async function authorizePreparation(req) {
  const session = await productionSheetSession(req, 'production');
  return { ...session, canWrite: true };
}
export async function handlePreparationActions(req, body, { authorize = authorizePreparation, clientFactory = createProgremesProductionClient } = {}) {
  const input = preparationInput(body);
  // Generating the sheet assigns material lots and therefore needs write access too.
  const startedAt = Date.now();
  const session = await authorize(req, input.operation !== 'context', input.operation);
  const authorizedAt = Date.now();
  if (!['tutti', 'team', 'propri'].includes(session.scope.mode) || session.scope.customer_code || session.scope.customer_codes?.length)
    throw fail('Operazione riservata agli addetti interni.', 403);
  try {
    const { result, mesContextMs } = await clientFactory().preparationActions({ ...input, externalId: input.externalId || randomUUID(), requestedBy: session.profile.id });
    console.info('[preparation-timing]', { operation: input.operation, authorizationMs: authorizedAt - startedAt,
      mesMs: Date.now() - authorizedAt, ...(Number.isFinite(mesContextMs) ? { mesContextMs } : {}) });
    requireCentralPrint(result, input.operation);
    return { ...result, canWrite: session.canWrite, canPrint: session.canPrint ?? session.canWrite };
  } catch (error) {
    if ([404, 405].includes(error.status)) throw fail('Aggiornare ProgreMES per utilizzare le azioni di preparazione da Workspace.', 503);
    throw error;
  }
}

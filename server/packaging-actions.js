import { randomUUID } from 'node:crypto';
import { costSession } from './production-action-session.js';
import { createProgremesProductionClient } from './progremes-production-client.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function packagingActionInput(body) {
  const productionOrderId = Number(body.productionOrderId), operation = body.operation;
  if (!Number.isSafeInteger(productionOrderId) || productionOrderId <= 0 || productionOrderId > 2147483647 ||
      !['thermal-read', 'thermal-print', 'start-context', 'start'].includes(operation)) throw fail('Operazione di confezionamento non valida.');
  const input = { productionOrderId, operation };
  if (operation === 'thermal-print') {
    input.labelCount = Number(body.labelCount); input.piecesPerBox = Number(body.piecesPerBox);
    if (!Number.isInteger(input.labelCount) || input.labelCount < 1 || input.labelCount > 1000 || !Number.isFinite(input.piecesPerBox) || input.piecesPerBox < 0 || input.piecesPerBox > 1000000000)
      throw fail('Indica da 1 a 1.000 etichette e un numero valido di pezzi per collo.');
  }
  if (operation.startsWith('start')) {
    input.resourceCode = String(body.resourceCode || '').trim();
    if (!input.resourceCode || input.resourceCode.length > 100) throw fail('Linea di confezionamento non disponibile per questa attività.');
  }
  if (operation === 'start') {
    input.productionId = Number(body.productionId);
    if (!Number.isSafeInteger(input.productionId) || input.productionId <= 0 || input.productionId > 2147483647) throw fail('Fase di confezionamento non valida.');
  }
  return input;
}
export async function handlePackagingActions(req, body, { authorize = costSession, clientFactory = createProgremesProductionClient } = {}) {
  const input = packagingActionInput(body);
  const write = ['thermal-print', 'start'].includes(input.operation);
  const session = await authorize(req, 'progremes.Produzione', write);
  if (!['tutti', 'team', 'propri'].includes(session.scope.mode) || session.scope.customer_code || session.scope.customer_codes?.length)
    throw fail('Operazione riservata agli utenti interni autorizzati alla produzione.', 403);
  try {
    const { result } = await clientFactory().packagingActions({ ...input, externalId: randomUUID(), requestedBy: String(session.profile.id) });
    return { ...result, canWrite: session.canWrite };
  } catch (error) {
    if ([404, 405].includes(error.status)) throw fail('Aggiornare ProgreMES per utilizzare etichette termiche e avvio confezionamento da Workspace.', 503);
    throw error;
  }
}

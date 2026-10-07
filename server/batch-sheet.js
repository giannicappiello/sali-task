import { reconcileBatchClosure } from './batch-closure-reconciliation.js';
import { operationalPrintId, requireCentralPrint } from './operational-print.js';
import { randomUUID } from 'node:crypto';
import { productionSheetSession } from './production-sheet-access.js';
import { createProgremesProductionClient } from './progremes-production-client.js';

export async function handleBatchSheet(req, body, { authorize = productionSheetSession, clientFactory = createProgremesProductionClient, wait } = {}) {
  const { kind, operation, phaseId, contentHash } = body;
  const productionOrderId = Number(body.productionOrderId);
  const fail = message => Object.assign(new Error(message), { status: 400 });
  if (!Number.isSafeInteger(productionOrderId) || productionOrderId <= 0 || productionOrderId > 2147483647
      || !['production', 'packaging'].includes(kind) || !['list', 'sheet', 'print', 'start', 'actual-sheet', 'complete-sheet', 'archive-status'].includes(operation))
    throw fail('Richiesta batch non valida.');
  if (operation !== 'list' && !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(phaseId || '')) throw fail('Seleziona il batch.');
  if (['print', 'start', 'complete-sheet'].includes(operation) && !/^[a-f0-9]{64}$/i.test(contentHash || '')) throw fail('Riapri il foglio del batch.');
  if (['actual-sheet', 'complete-sheet', 'archive-status'].includes(operation) && kind !== 'packaging') throw fail('Seleziona il confezionamento.');
  if (operation === 'complete-sheet' && (!body.actual || typeof body.actual !== 'object')) throw fail('Compilare il foglio.');
  const externalId = operation === 'print' ? operationalPrintId(body) : randomUUID();
  const session = await authorize(req, kind);
  if (!['tutti', 'team', 'propri'].includes(session.scope.mode) || session.scope.customer_code || session.scope.customer_codes?.length)
    throw Object.assign(new Error('Operazione riservata agli addetti interni.'), { status: 403 });
  const client = clientFactory();
  try {
    const { result } = await client.batchSheet({ externalId, printMode: operation === 'print' ? 'server' : undefined, productionOrderId, kind, operation,
      phaseId, contentHash, startAfterPrint: operation === 'print' && body.startAfterPrint === true, allowShortage: ['start', 'print'].includes(operation) && kind === 'production' && body.allowShortage === true, actual: operation === 'complete-sheet' ? body.actual : undefined, requestedBy: session.profile.id });
    requireCentralPrint(result, operation);
    return { ...result, canPrint: true, canStart: true };
  } catch (error) {
    if (operation === 'complete-sheet' && [502, 503, 504].includes(error.status)) {
      const verified = await reconcileBatchClosure(client, { productionOrderId, kind, phaseId, requestedBy: session.profile.id }, { wait });
      return { ...verified, canPrint: true, canStart: true };
    }
    if ([404, 405].includes(error.status)) throw Object.assign(new Error('Aggiornare il server MES per aprire i fogli dei batch da Attività.'), { status: 503 });
    throw error;
  }
}

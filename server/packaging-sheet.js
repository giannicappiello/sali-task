import { randomUUID } from 'node:crypto';
import { costSession } from './production-action-session.js';
import { createProgremesProductionClient } from './progremes-production-client.js';

export async function handlePackagingSheet(req, body, { authorize = costSession, clientFactory = createProgremesProductionClient } = {}) {
  const id = Number(body.productionOrderId), operation = body.operation || 'read';
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647 || !['read', 'print'].includes(operation))
    throw Object.assign(new Error('Richiesta foglio di confezionamento non valida.'), { status: 400 });
  const piecesPerBox = body.piecesPerBox == null ? null : Number(body.piecesPerBox);
  if (piecesPerBox != null && (!Number.isFinite(piecesPerBox) || piecesPerBox < 0 || piecesPerBox > 1000000000))
    throw Object.assign(new Error('Pezzi per collo non validi.'), { status: 400 });
  const session = await authorize(req, 'progremes.Produzione', operation === 'print');
  if (!['tutti', 'team', 'propri'].includes(session.scope.mode) || session.scope.customer_code || session.scope.customer_codes?.length)
    throw Object.assign(new Error('Foglio riservato agli utenti interni autorizzati alla produzione.'), { status: 403 });
  try {
    const { result } = await clientFactory().packagingSheet({ externalId: randomUUID(), productionOrderId: id, operation, piecesPerBox, requestedBy: String(session.profile.id) });
    return { ...result, canPrint: session.canWrite };
  } catch (error) {
    if ([404, 405].includes(error.status)) throw Object.assign(new Error('Il servizio foglio di confezionamento richiede l’aggiornamento di ProgreMES. Aggiornare MES e riprovare.'), { status: 503 });
    throw error;
  }
}

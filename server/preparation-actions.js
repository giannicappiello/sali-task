import { randomUUID } from 'node:crypto';
import { costSession } from './production-action-session.js';
import { createProgremesReadonlyAdmin } from './progremes-readonly-auth.js';
import { createProgremesProductionClient } from './progremes-production-client.js';
import { mixingDepartmentAccess } from './mixing-access.js';

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
    input.contentHash = String(body.contentHash || '');
    if (!/^[a-f0-9]{64}$/i.test(input.contentHash)) throw fail('Riapri l’anteprima del foglio prima di stampare.');
  }
  return input;
}
async function preparationSession(req, write) {
  let screenSession;
  try { screenSession = await costSession(req, 'progremes.OperatoreProduzione', false); }
  catch (error) { if (error.status !== 403) throw error; }
  if (screenSession) {
    if (write && !screenSession.canWrite) throw fail('Permesso di sola lettura: avvio e stampa non autorizzati.', 403);
    return screenSession;
  }
  const admin = createProgremesReadonlyAdmin();
  const token = /^Bearer (.+)$/i.exec(String(req.headers?.authorization || ''))?.[1];
  const auth = await admin.auth.getUser(token);
  if (auth.error || !auth.data?.user) throw fail('Sessione non valida.', 401);
  const profile = await admin.from('utenti').select('id,attivo,reparto_id,auth_user_id,ruoli(nome)').eq('auth_user_id', auth.data.user.id).maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data || profile.data.attivo === false || /client|portal/i.test(profile.data.ruoli?.nome || '')) throw fail('Accesso riservato agli addetti interni.', 403);
  const [links, legacy, mixingAccess] = await Promise.all([
    admin.from('workspace_customer_user_links').select('customer_code').eq('user_id', profile.data.id),
    admin.from('workspace_private_document_customer_access').select('codice_cliente').eq('utente_id', profile.data.id),
    mixingDepartmentAccess(admin, profile.data.id, profile.data),
  ]);
  if (links.error || legacy.error) throw links.error || legacy.error;
  if (links.data.length || legacy.data.length || !mixingAccess) throw fail('Accesso riservato all’area Miscelazione.', 403);
  return { profile: profile.data, scope: { mode: 'team' }, canWrite: true };
}
export async function handlePreparationActions(req, body, { authorize = preparationSession, clientFactory = createProgremesProductionClient } = {}) {
  const input = preparationInput(body);
  // Generating the sheet assigns material lots and therefore needs write access too.
  const startedAt = Date.now();
  const session = await authorize(req, input.operation !== 'context');
  const authorizedAt = Date.now();
  if (!['tutti', 'team', 'propri'].includes(session.scope.mode) || session.scope.customer_code || session.scope.customer_codes?.length)
    throw fail('Operazione riservata agli addetti interni.', 403);
  try {
    const { result, mesContextMs } = await clientFactory().preparationActions({ ...input, externalId: randomUUID(), requestedBy: session.profile.id });
    console.info('[preparation-timing]', { operation: input.operation, authorizationMs: authorizedAt - startedAt,
      mesMs: Date.now() - authorizedAt, ...(Number.isFinite(mesContextMs) ? { mesContextMs } : {}) });
    return { ...result, canWrite: session.canWrite };
  } catch (error) {
    if ([404, 405].includes(error.status)) throw fail('Aggiornare ProgreMES per utilizzare le azioni di preparazione da Workspace.', 503);
    throw error;
  }
}

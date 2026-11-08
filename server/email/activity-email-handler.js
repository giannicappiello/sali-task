import { waitUntil } from '@vercel/functions';
import process from 'node:process';
import { authorizeAIRequest } from '../ai/access.js';
import { createReceipt, verifyReceipt } from '../second-brain/handler.js';
import { objectSchema, uuidSchema, validateInput } from '../second-brain/schema.js';
import {
  getActivityEmailContext, listActivityEmails, proposeActivityEmail,
  getActivityEmail, decideActivityEmail, hashActivityEmail,
} from './activity-email-service.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const activityEmailInputSchema = objectSchema({
  taskId: uuidSchema,
  recipient: { type: 'string', format: 'email', maxLength: 254 },
  subject: { type: 'string', minLength: 1, maxLength: 200 },
  body: { type: 'string', minLength: 1, maxLength: 12000 },
  idempotencyKey: uuidSchema,
}, ['taskId', 'recipient', 'subject', 'body', 'idempotencyKey']);
const schemas = {
  context: objectSchema({ action: { const: 'context' }, taskId: uuidSchema }, ['action', 'taskId']),
  history: objectSchema({ action: { const: 'history' }, taskId: uuidSchema, offset: { type: 'integer', minimum: 0, maximum: 100000 } }, ['action', 'taskId']),
  propose: objectSchema({ action: { const: 'propose' }, ...activityEmailInputSchema.properties }, ['action', ...activityEmailInputSchema.required]),
  confirmation: objectSchema({ action: { const: 'confirmation' }, id: uuidSchema }, ['action', 'id']),
  decide: objectSchema({ action: { const: 'decide' }, receipt: { type: 'string', minLength: 1, maxLength: 4096 }, decision: { enum: ['confirm', 'reject'] } }, ['action', 'receipt', 'decision']),
};
const services = { getActivityEmailContext, listActivityEmails, proposeActivityEmail, getActivityEmail, decideActivityEmail, hashActivityEmail };

export async function dispatchActivityEmailSafely(email, dispatch) {
  if (email?.status !== 'queued') return undefined;
  try {
    const trigger = dispatch || (await import('./activity-email-worker.js')).triggerActivityEmailWorker;
    if (!trigger) return { status: 'not_configured' };
    return await trigger();
  } catch {
    // The persisted authorization is valid even when wake-up fails. Never enqueue again.
    return { status: 'error', message: 'Email accodata. Avvio del servizio non verificato; consulta lo storico.' };
  }
}

export function scheduleActivityEmailDispatch(email, { dispatch, schedule = waitUntil } = {}) {
  if (email?.status !== 'queued') return undefined;
  const work = dispatchActivityEmailSafely(email, dispatch);
  schedule(work);
  return { status: 'scheduled' };
}

export async function activityEmailRequest(req, dependencies = {}) {
  if (req.method !== 'POST') throw fail('Metodo non consentito.', 405);
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 20000) throw fail('Richiesta email non valida.');
  const schema = schemas[body.action];
  if (!schema) throw fail('Azione email non riconosciuta.');
  validateInput(schema, body);
  const auth = await (dependencies.authorize || authorizeAIRequest)(req, { bypassAIEntitlements: true });
  const service = { ...services, ...dependencies.services };
  if (body.action === 'context') return service.getActivityEmailContext(auth, { taskId: body.taskId });
  if (body.action === 'history') return service.listActivityEmails(auth, { taskId: body.taskId, offset: body.offset || 0 });
  if (body.action === 'propose') {
    const input = Object.fromEntries(Object.entries(body).filter(([name]) => name !== 'action'));
    const email = await service.proposeActivityEmail(auth, input, { viaAI: false });
    return { email, requiresConfirmation: true, sent: false };
  }
  const key = dependencies.receiptKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw fail('Conferma email non disponibile.', 503);
  if (body.action === 'confirmation') {
    const email = await service.getActivityEmail(auth, body.id);
    if (email.author_id !== auth.profile.id) throw fail('Puoi confermare soltanto una tua proposta email.', 403);
    if (email.status !== 'proposed') return { terminal: true, email };
    // AI proposals keep the existing separate human review and AI permission checks.
    if (email.via_ai) throw fail('Apri il riepilogo Progre AI per confermare questa proposta.', 403);
    const receipt = createReceipt({ userId: auth.profile.id, kind: 'activity-email', id: email.id, hash: service.hashActivityEmail(email), expires: Date.now() + 300000 }, key);
    return { receipt, email, identity: { id: auth.profile.id, name: auth.profile.nome }, expiresInSeconds: 300 };
  }
  const receipt = verifyReceipt(body.receipt, key, auth.profile.id);
  if (receipt.kind !== 'activity-email') throw fail('Conferma non valida per questa email.', 403);
  const current = await service.getActivityEmail(auth, receipt.id);
  if (current.author_id !== auth.profile.id || current.via_ai) throw fail('Proposta email non confermabile da questa schermata.', 403);
  if (service.hashActivityEmail(current) !== receipt.hash) throw fail('La proposta email è cambiata. Riapri il riepilogo.', 409);
  const email = await service.decideActivityEmail(auth, { id: receipt.id, confirm: body.decision === 'confirm', expectedHash: receipt.hash });
  return { email, dispatch: scheduleActivityEmailDispatch(email, { dispatch: dependencies.dispatch, schedule: dependencies.schedule }), sent: false };
}

export async function handleActivityEmail(req, res, dependencies = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try { return res.status(200).json({ success: true, ...await activityEmailRequest(req, dependencies) }); }
  catch (error) {
    const candidate = Number(error.status || 500);
    const status = candidate >= 400 && candidate <= 599 ? candidate : 500;
    return res.status(status).json({ success: false, error: status < 500 ? error.message : 'Operazione email non conclusa. Controlla lo storico prima di ripetere.' });
  }
}

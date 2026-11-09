import {emailRecipientSchema, emailRecipientAlternatives} from '../email/email-recipients.js';
import { objectSchema, uuidSchema } from './schema.js';
import { canReadModule } from '../ai/operational-read.js';
import { getActivityEmailContext, listActivityEmails, proposeActivityEmail, getActivityEmail } from '../email/activity-email-service.js';

const inputSchema = {...objectSchema({
  taskId: uuidSchema, ...emailRecipientSchema,
  subject: { type: 'string', minLength: 1, maxLength: 200 }, body: { type: 'string', minLength: 1, maxLength: 12000 },
  idempotencyKey: uuidSchema,
}, ['taskId', 'subject', 'body', 'idempotencyKey']), oneOf: emailRecipientAlternatives};
const read = (description, schema, execute) => ({ description, inputSchema: schema, effect: 'read', execute });
export function activityEmailTools(auth) {
  if (!canReadModule(auth, ['attivita'])) return {};
  const tools = {
    ACTIVITY_EMAIL_CONTEXT: read('Legge attività corrente, permessi email specifici e storico. Nessun invio. Verifica identità e destinatario prima della proposta.', objectSchema({ taskId: uuidSchema }, ['taskId']), input => getActivityEmailContext(auth, input)),
    ACTIVITY_EMAIL_HISTORY: read('Legge lo storico email dell’attività autorizzata. accepted indica accettazione del server, non consegna. uncertain richiede verifica umana: non reinviare.', objectSchema({ taskId: uuidSchema, offset: { type: 'integer', minimum: 0, maximum: 100000 } }, ['taskId']), input => listActivityEmails(auth, input)),
    ACTIVITY_EMAIL_STATUS: read('Legge una email autorizzata e il suo esito persistito. Non accoda né ripete invii.', objectSchema({ id: uuidSchema }, ['id']), ({ id }) => getActivityEmail(auth, id)),
  };
  const canWrite = auth.profile?.ruoli?.amministratore_workspace === true || ['scrittura', 'amministrazione'].includes(auth.access?.module_levels?.attivita);
  if (canWrite && ['bozza', 'conferma'].includes(auth.capabilities?.role_ai_level)) tools.ACTIVITY_EMAIL_PROPOSE = {
    description: 'Prepara una email per una attività accessibile, con destinatari To/CC verificati (massimo 10 totali), oggetto e testo. Richiede richiesta esplicita dell’utente, permesso email specifico e conferma umana separata BRAIN_REVIEW kind=email. Non invia. Conserva idempotencyKey nei tentativi e leggi lo stato dopo un esito incerto. Non autorizza invii ricorrenti.',
    inputSchema, effect: 'propose', execute: async input => ({ email: await proposeActivityEmail(auth, input, { viaAI: true }), requiresConfirmation: true, reviewKind: 'email', sent: false }),
  };
  return tools;
}

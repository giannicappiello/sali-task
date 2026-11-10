import { canReadModule } from '../ai/operational-read.js';
import { objectSchema, uuidSchema } from '../second-brain/schema.js';
const checked = result => { if (result.error) throw Object.assign(Error('Registro anomalie non disponibile.'), { status: 503 }); return result.data; };
export async function readAnomalies(auth, input = {}) {
 if (!canReadModule(auth, ['anomalie'])) throw Object.assign(Error('Accesso Anomalie non autorizzato.'), { status: 403 });
 const offset = input.offset ?? 0, limit = input.limit ?? 50;
 if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Object.assign(Error('Pagina non valida.'), { status: 400 });
 let query = auth.scoped.from('anomalies').select('*').order('last_seen_at', { ascending: false }).order('id').range(offset, offset + limit);
 if (Array.isArray(auth.capabilities?.allowed_modules)) query = query.containedBy('source_modules', auth.capabilities.allowed_modules);
 if (input.id) query = query.eq('id', input.id);
 if (input.status) query = query.eq('status', input.status);
 if (input.category) query = query.eq('category', input.category);
 const rows = checked(await query), more = rows.length > limit;
 return { items: rows.slice(0, limit).map(row => ({ ...row, url: `https://workspace.progre.it/anomalie/${row.id}` })), nextOffset: more ? offset + limit : null, scope: 'personal_workspace_rls', completeWorkspace: false };
}
export function anomalyTools(auth) {
 if (!canReadModule(auth, ['anomalie'])) return {};
 const readSchema = objectSchema({ id: uuidSchema, status: { type: 'string', enum: ['open', 'acknowledged', 'investigating', 'waiting', 'resolved', 'dismissed'] }, category: { type: 'string', maxLength: 80 }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } });
 const tools = {
  ANOMALIES_READ: { description: 'Legge il registro centrale anomalie autorizzate, con paginazione, prove e link Workspace. Rispetta area, modulo, fonti e ambito RLS; nessuna modifica.', inputSchema: readSchema, effect: 'read', execute: input => readAnomalies(auth, input) },
  ANOMALY_HISTORY: { description: 'Legge commenti e storico di una anomalia autorizzata. Nessuna modifica.', inputSchema: objectSchema({ id: uuidSchema, offset: { type: 'integer', minimum: 0 } }, ['id']), effect: 'read', execute: async input => {
   if (!(await readAnomalies(auth,{ id:input.id,limit:1 })).items.length) return {items:[],nextOffset:null};
   const offset = input.offset ?? 0;
   const rows = checked(await auth.scoped.from('anomaly_events').select('*').eq('anomaly_id', input.id).order('created_at').order('id').range(offset, offset + 50));
   return { items: rows.slice(0, 50), nextOffset: rows.length > 50 ? offset + 50 : null };
  } },
  ANOMALY_AGENT_STATUS: { description: 'Legge configurazione, stato di attivazione e lacune degli agenti anomalie. Non attiva servizi.', inputSchema: objectSchema({}), effect: 'read', execute: async () => checked(await auth.scoped.from('anomaly_agents').select('*')) },
 };
 if (auth.capabilities?.role_ai_level === 'conferma') tools.ANOMALY_UPDATE = {
  description: 'Prepara soltanto una proposta di stato, owner, commento o intervento suggerito. Leggere prima versione corrente. Richiede permesso specifico, BRAIN_REVIEW kind=brain e conferma manuale Workspace. Non esegue ordini, planning o interventi gestionali.', effect: 'propose',
  inputSchema: objectSchema({ id: uuidSchema, expectedVersion: { type: 'integer', minimum: 1 }, status: readSchema.properties.status, ownerId: uuidSchema, taskId: uuidSchema, comment: { type: 'string', minLength: 1, maxLength: 4000 }, correctiveProposal: { type: 'object', additionalProperties: false, required: ['description'], properties: { description: { type: 'string', minLength: 1, maxLength: 4000 } } } }, ['id', 'expectedVersion']),
  execute: async input => ({ kind: 'brain', proposal: checked(await auth.scoped.rpc('anomaly_propose', { p_input: input })) }),
 };
 if (auth.profile?.ruoli?.amministratore_workspace === true && auth.capabilities?.role_ai_level === 'conferma') tools.ANOMALY_CONFIGURE = {
  description: 'Prepara la configurazione destinatari dell’agente Fabbisogni. Responsabile reparto e amministratori sono letti dinamicamente; override e destinatari aggiuntivi configurabili. Richiede BRAIN_REVIEW kind=brain e conferma manuale Workspace. Attivazione bloccata finché tutti i prerequisiti non sono verificati.', effect: 'propose',
  inputSchema: objectSchema({ expectedVersion: { type: 'integer', minimum: 1 }, enabled: { type: 'boolean' }, recipientPolicy: objectSchema({ departmentManager: { type: 'boolean' }, workspaceAdmins: { type: 'boolean' }, departmentOverrides: { type: 'object', propertyNames: uuidSchema, additionalProperties: uuidSchema }, additionalUserIds: { type: 'array', maxItems: 50, uniqueItems: true, items: uuidSchema } }, ['departmentManager', 'workspaceAdmins', 'departmentOverrides', 'additionalUserIds']) }, ['expectedVersion', 'recipientPolicy', 'enabled']),
  execute: async input => ({ kind: 'brain', proposal: checked(await auth.scoped.rpc('anomaly_configure_propose', { p_input: input })) }),
 };
 return tools;
}

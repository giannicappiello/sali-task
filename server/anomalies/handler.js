import { authorizeAIRequest } from '../ai/access.js';
import { anomalyTools, readAnomalies } from './tools.js';
import { canReadModule } from '../ai/operational-read.js';
import { businessWindow } from './engine.js';
import { recoverAnomalyRun } from './worker.js';
import { objectSchema, uuidSchema } from '../second-brain/schema.js';
import { validateInput } from '../second-brain/schema.js';
import { createProgremesReadonlyAdmin } from '../progremes-readonly-auth.js';
export async function handleAnomalies(req, res, { authorize = authorizeAIRequest, admin = createProgremesReadonlyAdmin, recover = recoverAnomalyRun } = {}) {
 res.setHeader('Cache-Control', 'no-store');
 try {
  const auth = await authorize(req, { bypassAIEntitlements: req.method === 'GET' });
  const tools = anomalyTools(auth);
  if (!tools.ANOMALIES_READ) throw Object.assign(Error('Accesso Anomalie non autorizzato.'), { status: 403 });
  if (req.method === 'GET') {
   const input = { offset: Number(req.query.offset || 0), ...(req.query.id ? { id: req.query.id } : {}), ...(req.query.status ? { status: req.query.status } : {}) };
   validateInput(tools.ANOMALIES_READ.inputSchema, input);
   const [result, agents, dashboard] = await Promise.all([readAnomalies(auth, input), tools.ANOMALY_AGENT_STATUS.execute({}), auth.scoped.rpc('anomaly_dashboard')]);
   if (dashboard.error) throw Object.assign(Error('Dashboard anomalie non disponibile.'), { status:503 });
   let configuration = null, recoveryRun = null;
   if (auth.profile.ruoli?.amministratore_workspace === true) {
    const [users, departments] = await Promise.all([auth.scoped.from('utenti').select('id,nome,cognome,email').eq('attivo',true).order('cognome'), auth.scoped.from('reparti').select('id,nome').eq('attivo',true).order('nome')]);
    if (users.error || departments.error) throw Object.assign(Error('Configurazione destinatari non disponibile.'), { status:503 });
    configuration = { users: users.data, departments: departments.data };
    if (auth.capabilities?.role_ai_level === 'conferma' && ['anomalie','progremes','magazzino'].every(module => canReadModule(auth,[module]))) {
     const today = businessWindow().from;
     const result = await auth.scoped.from('anomaly_runs').select('id,business_day,status').eq('agent_code','fabbisogni').eq('business_day',today).maybeSingle();
     if (!result.error) recoveryRun = result.data;
    }
   }
   return res.json({ ...result, configuration, recoveryRun, dashboard: dashboard.data, agent: agents.find(x => x.code === 'fabbisogni') || null, ...(input.id ? { history: await tools.ANOMALY_HISTORY.execute({ id: input.id }) } : {}) });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });
  if (req.query.action === 'recover_delivery') {
   if (auth.profile?.ruoli?.amministratore_workspace !== true || auth.capabilities?.role_ai_level !== 'conferma' || !['anomalie','progremes','magazzino'].every(module => canReadModule(auth,[module]))) throw Object.assign(Error('Recupero riservato agli amministratori autorizzati per Anomalie, ProgreMES e Magazzino.'), {status:403});
   validateInput(objectSchema({run_id:uuidSchema},['run_id']),req.body);
   // RLS must make the existing run visible before accessing the delivery service.
   const visible = await auth.scoped.from('anomaly_runs').select('id').eq('id',req.body.run_id).maybeSingle();
   if (visible.error || !visible.data) throw Object.assign(Error('Report non disponibile nel tuo ambito.'),{status:403});
   return res.json(await recover(admin(),{runId:req.body.run_id,ownerId:auth.profile.id}));
  }
  const tool = req.query.action === 'configure' ? tools.ANOMALY_CONFIGURE : tools.ANOMALY_UPDATE;
  if (req.query.action === 'readiness') {
   if (auth.profile?.ruoli?.amministratore_workspace !== true || auth.capabilities?.role_ai_level !== 'conferma') throw Object.assign(Error('Verifica prerequisiti riservata ad amministratori Workspace.'), { status: 403 });
   const { verifyAnomalyReadiness } = await import('./delivery.js');
   return res.json(await verifyAnomalyReadiness(createProgremesReadonlyAdmin(), { ownerId: auth.profile.id }));
  }
  if (!tool) throw Object.assign(Error('Proposte non autorizzate.'), { status: 403 });
  validateInput(tool.inputSchema, req.body);
  const result = await tool.execute(req.body);
  return res.json({ ...result, reviewUrl: `https://workspace.progre.it/assistente-ai?view=review&kind=brain&proposalId=${result.proposal.id}` });
 } catch (error) { return res.status(error.status || 500).json({ error: error.status ? error.message : 'Operazione non conclusa. Verificare lo stato persistito prima di ripetere.' }); }
}

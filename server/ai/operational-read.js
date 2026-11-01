import { jsonSchema } from 'ai';

const crmModules = { conto_terzi: 'crm_conto_terzi', b2b: 'crm_b2b', online: 'crm_online' };
export function canReadModule(auth, modules) {
  if (auth.capabilities?.internal_data !== true) return false;
  if (auth.profile?.ruoli?.amministratore_workspace === true) return true;
  return modules.some(module => auth.access?.modules?.includes(module) && (!Array.isArray(auth.capabilities.allowed_modules) || auth.capabilities.allowed_modules.includes(module)));
}
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Data non valida, usare AAAA-MM-GG.');
  return value;
}
const denied = () => Object.assign(new Error('Lettura non autorizzata per il profilo e il perimetro AI.'), { status: 403 });
export async function readOperationalData(auth, operation, input) {
  let rpc, args, offset;
  if (operation === 'hr') {
    if (!canReadModule(auth, ['hr', 'human_resources'])) throw denied();
    if (input.configuration === true && auth.profile?.ruoli?.amministratore_workspace !== true) throw denied();
    rpc = 'workspace_hr_snapshot'; args = { p_month: day(input.month), p_config: input.configuration === true };
  } else if (operation === 'calendar') {
    if (!canReadModule(auth, ['hr', 'human_resources', 'progremes'])) throw denied();
    rpc = 'workspace_company_calendar_read'; args = {};
  } else if (operation === 'customers') {
    const module = Object.hasOwn(crmModules, input.type) ? crmModules[input.type] : null;
    if (!module || !canReadModule(auth, [module])) throw denied();
    const from = day(input.from), to = day(input.to);
    if (from > to || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new Error('Scegliere un periodo ordinato di massimo un anno.');
    offset = input.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new Error('Pagina non valida.');
    if (!['active', 'inactive', 'all'].includes(input.status || 'active')) throw new Error('Stato cliente non valido.');
    // SQL pagination is mandatory. A PostgREST range neither supplies these
    // function arguments nor replaces pagination inside the function.
    rpc = 'crm_customer_metric_details'; args = { p_crm_type: input.type, p_from: from, p_to: to, p_metric: 'all', p_search: String(input.query || '').slice(0, 160) || null, p_customer_status: input.status || 'active', p_limit: 51, p_offset: offset };
    if (input.orderModule !== undefined) {
      if (input.type !== 'b2b' || !['prof', 'ph'].includes(input.orderModule)) throw new Error('Perimetro ordini CRM non valido.');
      if (!canReadModule(auth, [input.orderModule === 'prof' ? 'ordini_pr' : 'ordini_ph'])) throw denied();
      const group = input.customerGroup ?? (input.orderModule === 'prof' ? 'regular' : 'all');
      if (!['all', 'regular', 'mypharma'].includes(group) || (input.orderModule === 'ph' && group !== 'all')) throw new Error('Gruppo clienti non valido per il modulo ordini.');
      rpc = 'crm_b2b_order_customer_details';
      Object.assign(args, { p_order_module: input.orderModule, p_customer_group: group, p_agent: input.agent || null });
    } else if (input.customerGroup !== undefined || input.agent !== undefined) {
      throw new Error('Specificare orderModule per filtrare gruppo clienti o agente.');
    }
  } else throw new Error('Operazione non disponibile.');
  // Reuse the same authorization-enforcing RPCs as the product UI, always with the user's JWT.
  const request = auth.scoped.rpc(rpc, args);
  const { data, error } = await request;
  if (error) throw error;
  return { source: rpc, readAt: new Date().toISOString(), data: offset === undefined ? data : (data || []).slice(0, 50), nextOffset: offset !== undefined && data?.length > 50 ? offset + 50 : null };
}
export function operationalReadTools(auth) {
  const tools = {};
  if (canReadModule(auth, ['hr', 'human_resources'])) tools.HR_READ = {
    description: 'Legge presenze, richieste, dipendenti e calendario del mese con gli stessi permessi della schermata HR. Gli accordi economici richiedono configuration=true e ruolo admin.',
    inputSchema: jsonSchema({ type: 'object', additionalProperties: false, required: ['month'], properties: { month: { type: 'string', description: 'Primo giorno del mese, AAAA-MM-01.' }, configuration: { type: 'boolean' } } }), execute: input => readOperationalData(auth, 'hr', input),
  };
  if (canReadModule(auth, ['hr', 'human_resources', 'progremes'])) tools.COMPANY_CALENDAR_READ = {
    description: 'Legge orari, versioni e chiusure del calendario aziendale condiviso.', inputSchema: jsonSchema({ type: 'object', additionalProperties: false, properties: {} }), execute: () => readOperationalData(auth, 'calendar', {}),
  };
  const types = Object.entries(crmModules).filter(([, module]) => canReadModule(auth, [module])).map(([type]) => type);
  if (types.length) tools.CRM_CUSTOMER_SEARCH = {
    description: 'Cerca clienti Workspace/Mexal e metriche ufficiali per periodo. Il nome agente è in agente_classificazione: usare sempre i nomi nei report. Per la schermata Ordini PR usare type=b2b, orderModule=prof, customerGroup=regular; MyPharma è separato. Per Ordini PH usare orderModule=ph. Filtri e importi riutilizzano le RPC della schermata, non le somme della cache ordini. Paginare finché nextOffset è null.',
    inputSchema: jsonSchema({ type: 'object', additionalProperties: false, required: ['type', 'from', 'to'], properties: { type: { type: 'string', enum: types }, from: { type: 'string' }, to: { type: 'string' }, query: { type: 'string', maxLength: 160 }, status: { type: 'string', enum: ['active', 'inactive', 'all'] }, offset: { type: 'integer', minimum: 0 }, orderModule: { type: 'string', enum: ['prof', 'ph'] }, customerGroup: { type: 'string', enum: ['all', 'regular', 'mypharma'] }, agent: { type: 'string', maxLength: 80 } } }), execute: input => readOperationalData(auth, 'customers', input),
  };
  return tools;
}

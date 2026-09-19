import { createProgremesReadonlyAdmin } from './progremes-readonly-auth.js';
import { createProgremesClient } from './progremes-readonly-client.js';
import { readActiveProductionPlan } from './hr-active-production-plan.js';

const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const fail = (message, status) => Object.assign(new Error(message), { status });

export function productionDepartments(names) {
  const values = new Set(names.map(normalize));
  if (values.has('produzione') || values.has('addettoproduzione')) return ['Production', 'Packaging', 'Cartoning'];
  return [
    ...(values.has('miscelazione') || values.has('addettomiscelazione') ? ['Production'] : []),
    ...(values.has('confezionamento') || values.has('addettoconfezionamento') ? ['Packaging', 'Cartoning'] : []),
  ];
}

export async function authorizeProductionCalendar(req, admin) {
  const token = /^Bearer (.+)$/i.exec(String(req.headers?.authorization || ''))?.[1];
  if (!token) throw fail('Accedi a Workspace per continuare.', 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user?.id) throw fail('Sessione Workspace non valida.', 401);
  const profile = await admin.from('utenti').select('id,attivo,reparto_id,ruoli(amministratore_workspace)').eq('auth_user_id', data.user.id).maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data || profile.data.attivo === false) throw fail('Utente non abilitato.', 403);
  if (profile.data.ruoli?.amministratore_workspace === true) return ['Production', 'Packaging', 'Cartoning'];
  const [member, memberships] = await Promise.all([
    admin.from('workspace_hr_members').select('active').eq('user_id', profile.data.id).maybeSingle(),
    admin.from('utenti_reparti').select('reparto_id').eq('utente_id', profile.data.id),
  ]);
  if (member.error || memberships.error) throw member.error || memberships.error;
  if (!member.data?.active) return [];
  const ids = [...new Set([profile.data.reparto_id, ...(memberships.data || []).map(row => row.reparto_id)].filter(Boolean))];
  if (!ids.length) return [];
  const departments = await admin.from('reparti').select('nome,attivo').in('id', ids);
  if (departments.error) throw departments.error;
  return productionDepartments(departments.data.filter(row => row.attivo !== false).map(row => row.nome));
}

// The existing MES endpoint uses containment date filters, not overlap filters.
// Read the persisted plan without those filters so work spanning months is retained.
export async function readProductionPlan(client) {
  const items = [];
  for (let page = 1; page <= 40; page++) {
    const result = await client.request('planning', { page, pageSize: 500 });
    items.push(...result.items);
    if (items.length >= result.total) return items;
    if (!result.items.length) throw fail('Piano MES incompleto. Riprova.', 502);
  }
  throw fail('Piano MES troppo esteso per la lettura del calendario.', 502);
}

let cachedPlan;
let cacheUntil = 0;
function currentProductionPlan() {
  if (!cachedPlan || Date.now() >= cacheUntil) {
    cacheUntil = Date.now() + 30000;
    cachedPlan = readActiveProductionPlan(undefined, () => readProductionPlan(createProgremesClient())).catch(error => {
      cachedPlan = undefined;
      throw error;
    });
  }
  return cachedPlan;
}

export function calendarRows(rows, allowed, from, to) {
  return rows.filter(row => allowed.includes(row.operationType)
    && !['annullato', 'annullata', 'cancelled', 'canceled'].includes(normalize(row.status))
    && String(row.start).slice(0, 10) <= to && String(row.end).slice(0, 10) >= from)
    .map(row => ({
      productionOrderId: row.productionOrderId, orderNumber: row.orderNumber,
      articleCode: row.articleCode, articleDescription: row.articleDescription,
      operationType: row.operationType, start: row.start, end: row.end, status: row.status,
      ...(row.resource ? { resource: row.resource } : {}),
      ...(row.resourceCode ? { resourceCode: row.resourceCode } : {}),
      ...(row.forecast ? { forecast: true } : {}),
    }));
}

export async function productionCalendarRequest(req, dependencies = {}) {
  if (req.method !== 'GET') throw fail('Metodo non consentito.', 405);
  const { from, to } = req.query || {};
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to || Date.parse(to) - Date.parse(from) > 160 * 86400000) throw fail('Periodo del calendario non valido.', 400);
  const allowed = await (dependencies.authorize || authorizeProductionCalendar)(req, dependencies.admin || createProgremesReadonlyAdmin());
  if (!allowed.length) {
    console.info('[hr-production-calendar]', { enabled: false, reason: 'no-eligible-hr-department' });
    return { items: [], enabled: false };
  }
  const plan = dependencies.readPlan ? await dependencies.readPlan() : dependencies.client ? { items: await readProductionPlan(dependencies.client), source: 'archivio' } : await currentProductionPlan();
  const items = calendarRows(plan.items, allowed, from, to);
  console.info('[hr-production-calendar]', { source: plan.source, allowed, total: plan.items.length, visible: items.length, from, to });
  return { items, enabled: true, source: plan.source, updatedAt: new Date().toISOString() };
}

export async function handleHrProductionCalendar(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try { return res.status(200).json(await productionCalendarRequest(req)); }
  catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('HR production calendar unavailable', { code: error.code, upstreamStatus: error.upstreamStatus });
    return res.status(status).json({ error: status < 500 ? error.message : 'Pianificazione MES non disponibile. Le lavorazioni potrebbero non essere visibili: riprova tra poco.' });
  }
}

import { createHash } from 'node:crypto';
import { createProgremesReadonlyAdmin } from './progremes-readonly-auth.js';
import { createProgremesClient } from './progremes-readonly-client.js';
import { readActiveProductionPlan } from './hr-active-production-plan.js';
import { calendarProjection } from './production-calendar-intervals.js';

import { privateWorkbenchSession } from './private-orders-workbench.js';
import { listProductionWorkbench } from './workspacemes-workbench.js';

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
  const links = await admin.from('workspace_customer_user_links').select('customer_code').eq('user_id', profile.data.id);
  if (links.error) throw links.error;
  if (links.data?.length) {
    const { orders, customerCodes } = await privateWorkbenchSession(req, { admin });
    if (!customerCodes.length) throw fail('Associazione cliente non disponibile.', 403);
    return { operations: ['Production', 'Packaging', 'Cartoning'], orders };
  }
  if (profile.data.ruoli?.amministratore_workspace === true) return ['Production', 'Packaging', 'Cartoning'];
  const [member, memberships, areas] = await Promise.all([
    admin.from('workspace_hr_members').select('active').eq('user_id', profile.data.id).maybeSingle(),
    admin.from('utenti_reparti').select('reparto_id').eq('utente_id', profile.data.id),
    admin.rpc('workspace_area_access_codes', { target_auth_user_id: data.user.id }),
  ]);
  if (member.error || memberships.error || areas.error) throw member.error || memberships.error || areas.error;
  const areaOperations = productionDepartments(areas.data || []);
  if (!member.data?.active) {
    const activityAccess = await admin.rpc('workspace_screen_level_for_user', { target_user_id: profile.data.id, target_screen: 'attivita.dashboard' });
    if (activityAccess.error) throw activityAccess.error;
    if (!['lettura', 'scrittura', 'amministrazione'].includes(activityAccess.data)) return areaOperations;
  }
  const ids = [...new Set([profile.data.reparto_id, ...(memberships.data || []).map(row => row.reparto_id)].filter(Boolean))];
  if (!ids.length) return areaOperations;
  const departments = await admin.from('reparti').select('nome,attivo').in('id', ids);
  if (departments.error) throw departments.error;
  return [...new Set([...areaOperations, ...productionDepartments(departments.data.filter(row => row.attivo !== false).map(row => row.nome))])];
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

// Cache completion times, share every in-flight read, and back off after failure.
// Keep the last successful plan; authorization is checked again for each request.
export function createProductionPlanCache({ read, now = Date.now, recheckMs = 30000, retryMs = 30000 }) {
  let last, pending, nextCheck = 0, failure;
  return function currentPlan() {
    if (pending) return pending;
    if (now() < nextCheck) {
      if (!last) return Promise.reject(failure);
      return Promise.resolve(failure ? { ...last, stale: true, warning: "MES non aggiornato: è mostrato l'ultimo calendario valido." } : last);
    }
    pending = Promise.resolve().then(() => read(last)).then(plan => {
      last = plan; failure = undefined; nextCheck = now() + (plan.stale ? Math.min(recheckMs, 5000) : recheckMs);
      return plan;
    }).catch(error => {
      nextCheck = now() + retryMs; failure = error;
      // Authentication failures must never be served from the previous cache.
      if ([401, 403].includes(error.status) || [401, 403].includes(error.upstreamStatus)) {
        last = undefined; throw error;
      }
      if (!last) throw error;
      return { ...last, stale: true, warning: "MES non aggiornato: è mostrato l'ultimo calendario valido." };
    }).finally(() => { pending = undefined; });
    return pending;
  };
}
const currentProductionPlan = createProductionPlanCache({
  read: previous => readActiveProductionPlan(undefined, () => readProductionPlan(createProgremesClient()), previous),
});

export function calendarRows(rows, allowed, from, to) {
  return rows.filter(row => allowed.includes(row.operationType)
    && !['annullato', 'annullata', 'cancelled', 'canceled'].includes(normalize(row.status))
    && String(row.start).slice(0, 10) <= to && String(row.end).slice(0, 10) >= from)
    .map(row => ({
      productionOrderId: row.productionOrderId, orderNumber: row.orderNumber,
      articleCode: row.articleCode, articleDescription: row.articleDescription,
      operationType: row.operationType, start: row.start, end: row.end, status: row.status, actualStart: row.actualStart || null,
      ...(Array.isArray(row.workingIntervals) ? { workingIntervals: row.workingIntervals } : {}),
      ...(row.resource ? { resource: row.resource } : {}),
      ...(row.resourceCode ? { resourceCode: row.resourceCode } : {}),
      customerName: row.customerName || '', rdpReference: row.rdpReference || '', octReference: row.octReference || '',
      ...(row.forecast ? { forecast: true } : {}),
    }));
}

export async function productionCalendarRequest(req, dependencies = {}) {
  if (req.method !== 'GET') throw fail('Metodo non consentito.', 405);
  const { from, to } = req.query || {};
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to || Date.parse(to) - Date.parse(from) > 160 * 86400000) throw fail('Periodo del calendario non valido.', 400);
  const admin = dependencies.admin || createProgremesReadonlyAdmin();
  const authorization = await (dependencies.authorize || authorizeProductionCalendar)(req, admin);
  const allowed = Array.isArray(authorization) ? authorization : authorization.operations;
  if (!allowed.length) {
    console.info('[hr-production-calendar]', { enabled: false, reason: 'no-eligible-hr-department' });
    return { items: [], enabled: false };
  }
  const plan = dependencies.readPlan ? await dependencies.readPlan() : dependencies.client ? { items: await readProductionPlan(dependencies.client), source: 'archivio' } : await currentProductionPlan();
  let rows = plan.items;
  const customerScoped = !Array.isArray(authorization);
  if (customerScoped) {
    // Reuse the exact Produzioni OCT/RdP reconciliation and customer order scope.
    const workbench = await (dependencies.workbench || listProductionWorkbench)({
      admin, scopedOrders: authorization.orders,
      productionOrders: rows.map(row => ({ id: row.productionOrderId,
        numeroOrdine: row.orderNumber, riferimentoRdp: row.rdpReference,
        riferimentoOct: row.octReference, codiceArticolo: row.articleCode, stato: row.status })),
    });
    const ids = new Set(workbench.items.flatMap(item => item.productionOrders || []).map(order => String(order.id)));
    rows = rows.filter(row => ids.has(String(row.productionOrderId))).map(row => ({
      ...row, resource: '', resourceCode: '', customerName: '', octReference: '', rdpReference: '',
    }));
  }
  rows = rows.filter(row => allowed.includes(row.operationType));
  let calendarConflicts = 0;
  if (rows.length) {
    const { data: calendar, error } = dependencies.readCalendar ? { data: await dependencies.readCalendar() }
      : await admin.rpc('workspace_company_calendar_data');
    if (error) throw error;
    rows = rows.map(row => {
      const projection = calendarProjection(row, calendar, from, to);
      if (projection.conflict) calendarConflicts++;
      return { ...row, workingIntervals: projection.intervals };
    })
      .filter(row => row.workingIntervals.length > 0);
  }
  const items = calendarRows(rows, allowed, from, to);
  console.info('[hr-production-calendar]', { source: plan.source, allowed, total: plan.items.length, visible: items.length, from, to });
  const warning = [plan.warning || (plan.stale ? "MES non aggiornato: è mostrato l'ultimo calendario valido." : ''),
    calendarConflicts ? 'Il piano contiene fasce confermate su orari ora chiusi. Sono mostrate solo le fasce del calendario aziendale; il responsabile deve ripianificare le lavorazioni in conflitto.' : ''].filter(Boolean).join(' ');
  const result = { items, enabled: true, source: plan.source, updatedAt: plan.updatedAt || null, stale: plan.stale === true, warning };
  // Hash the authorized projection, including company-calendar changes and warnings.
  const revision = createHash('sha256').update(JSON.stringify(result)).digest('hex');
  return req.query.revision === revision && !result.stale ? { notModified: true } : { ...result, revision };
}

export async function handleHrProductionCalendar(req, res) {
  const started = Date.now();
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const result = await productionCalendarRequest(req);
    return result.notModified ? res.status(304).end() : res.status(200).json(result);
  }
  catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('HR production calendar unavailable', { code: error.code, upstreamStatus: error.upstreamStatus, operation: error.operation, elapsedMs: Date.now() - started });
    return res.status(status).json({ error: status < 500 ? error.message : 'Pianificazione MES non disponibile. Le lavorazioni potrebbero non essere visibili: riprova tra poco.' });
  }
}

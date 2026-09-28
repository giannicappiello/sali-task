import { createProgremesReadonlyAdmin } from './progremes-readonly-auth.js';

const fail = (message, status = 403) => Object.assign(new Error(message), { status });
const check = result => { if (result.error) throw result.error; return result.data; };
export function sheetDepartments(names) {
  const values = names.map(name => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const all = values.some(v => ['produzione', 'addettoproduzione'].includes(v));
  return { production: all || values.some(v => ['miscelazione', 'addettomiscelazione'].includes(v)),
    packaging: all || values.some(v => ['confezionamento', 'addettoconfezionamento'].includes(v)) };
}

// Sheet access is independent of retired menu entries and grants no machine commands.
export async function productionSheetSession(req, kind, { admin } = {}) {
  if (!['production', 'packaging'].includes(kind)) throw fail('Tipo foglio non valido.');
  const token = /^Bearer (.+)$/i.exec(String(req.headers?.authorization || ''))?.[1];
  if (!token) throw fail('Sessione mancante.', 401);
  admin ??= createProgremesReadonlyAdmin();
  const auth = await admin.auth.getUser(token);
  if (auth.error || !auth.data?.user) throw fail('Sessione non valida.', 401);
  const profile = check(await admin.from('utenti').select('id,attivo,reparto_id,ruoli(nome,amministratore_workspace)').eq('auth_user_id', auth.data.user.id).maybeSingle());
  return productionSheetProfileAccess(admin, profile, auth.data.user.id, kind);
}
export async function productionSheetProfileAccess(admin, profile, authUserId, kind) {
  if (!profile || profile.attivo === false) throw fail('Utente non abilitato.');
  if (profile.ruoli?.amministratore_workspace === true) return { profile, scope: { mode: 'tutti' }, canPrint: true };
  const [memberships, areas, links, legacy] = await Promise.all([
    admin.from('utenti_reparti').select('reparto_id').eq('utente_id', profile.id),
    admin.rpc('workspace_area_access_codes', { target_auth_user_id: authUserId }),
    admin.from('workspace_customer_user_links').select('customer_code').eq('user_id', profile.id),
    admin.from('workspace_private_document_customer_access').select('codice_cliente').eq('utente_id', profile.id),
  ]);
  if (check(links)?.length || check(legacy)?.length || /client|portal/i.test(profile.ruoli?.nome || '')) throw fail('Foglio riservato agli addetti interni.');
  const ids = [...new Set([profile.reparto_id, ...check(memberships).map(row => row.reparto_id)].filter(Boolean))];
  const departments = ids.length ? check(await admin.from('reparti').select('nome,attivo').in('id', ids)) : [];
  const access = sheetDepartments([profile.ruoli?.nome, ...check(areas), ...departments.filter(d => d.attivo !== false).map(d => d.nome)]);
  if (!access[kind]) throw fail(kind === 'production' ? 'Foglio riservato a Miscelazione e Produzione.' : 'Foglio riservato a Confezionamento e Produzione.');
  return { profile, scope: { mode: 'team' }, canPrint: true };
}

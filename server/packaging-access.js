import { costSession } from './production-action-session.js';

// Department fallback is used only by packaging endpoints, never by general
// production administration or specification editing.
export async function packagingDepartmentAccess(admin, profileId) {
  const profile = await admin.from('utenti').select('attivo,reparto_id').eq('id', profileId).maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data || profile.data.attivo === false) return false;
  const [memberships, exceptions] = await Promise.all([
    admin.from('utenti_reparti').select('reparto_id').eq('utente_id', profileId),
    admin.from('workspace_eccezioni_utente').select('decisione,valida_fino_a').eq('utente_id', profileId).eq('ambito', 'schermata').in('codice', ['progremes.OperatoreConfezionamento', 'progremes.Produzione']),
  ]);
  for (const result of [memberships, exceptions]) if (result.error) throw result.error;
  if (exceptions.data.some(e => e.decisione === 'nega' && (!e.valida_fino_a || Date.parse(e.valida_fino_a) > Date.now()))) return false;
  const ids = [...new Set([profile.data.reparto_id, ...memberships.data.map(m => m.reparto_id)].filter(Boolean))];
  if (!ids.length) return false;
  const departments = await admin.from('reparti').select('nome,attivo').in('id', ids);
  if (departments.error) throw departments.error;
  return departments.data.some(d => d.attivo !== false && ['confezionamento','addettoconfezionamento'].includes(String(d.nome || '').toLowerCase().replace(/[^a-z0-9]/g, '')));
}

export function packagingSession(req, screen, write, dependencies = {}) {
  return costSession(req, screen, write, { ...dependencies, departmentAccess: packagingDepartmentAccess });
}

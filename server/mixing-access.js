import { productionDepartments } from './hr-production-calendar.js';

export async function mixingDepartmentAccess(admin, profileId) {
  const profile = await admin.from('utenti').select('attivo,reparto_id,auth_user_id').eq('id', profileId).maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data || profile.data.attivo === false) return false;
  const [memberships, areas, exceptions] = await Promise.all([
    admin.from('utenti_reparti').select('reparto_id').eq('utente_id', profileId),
    admin.rpc('workspace_area_access_codes', { target_auth_user_id: profile.data.auth_user_id }),
    admin.from('workspace_eccezioni_utente').select('decisione,valida_fino_a').eq('utente_id', profileId).eq('ambito', 'schermata').eq('codice', 'progremes.OperatoreProduzione'),
  ]);
  for (const r of [memberships, areas, exceptions]) if (r.error) throw r.error;
  if (exceptions.data.some(e => e.decisione === 'nega' && (!e.valida_fino_a || Date.parse(e.valida_fino_a) > Date.now()))) return false;
  if (productionDepartments(areas.data || []).includes('Production')) return true;
  const ids = [...new Set([profile.data.reparto_id, ...memberships.data.map(m => m.reparto_id)].filter(Boolean))];
  if (!ids.length) return false;
  const departments = await admin.from('reparti').select('nome,attivo').in('id', ids);
  if (departments.error) throw departments.error;
  return productionDepartments(departments.data.filter(d => d.attivo !== false).map(d => d.nome)).includes('Production');
}

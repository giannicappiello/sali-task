export const DEVELOPMENT_CAPABILITIES = ['develop', 'publish', 'browser', 'database'];
export const isDevelopmentAdmin = auth => auth.profile?.ruoli?.amministratore_workspace === true;
export const hasDevelopmentPermission = (auth, capability) => isDevelopmentAdmin(auth) || auth.developmentPermissions?.[capability] === true;

export async function loadDevelopmentPermissions(admin, profile) {
  if (profile.ruoli?.amministratore_workspace === true) return Object.fromEntries(DEVELOPMENT_CAPABILITIES.map(key => [key, true]));
  const { data, error } = await admin.from('ai_development_permissions').select('develop,publish,browser,database').eq('user_id', profile.id).maybeSingle();
  if (error) throw error;
  return data || {};
}

export async function manageDevelopmentPermissions(auth, body) {
  if (!isDevelopmentAdmin(auth)) throw Object.assign(new Error('Solo un amministratore può configurare i permessi di sviluppo.'), { status: 403 });
  if (body.action === 'development_permissions_save') {
    if (!/^[a-f0-9-]{36}$/i.test(body.userId || '') || !body.permissions || DEVELOPMENT_CAPABILITIES.some(key => typeof body.permissions[key] !== 'boolean')) throw new Error('Permessi non validi.');
    if (body.permissions.publish && !body.permissions.develop) throw new Error('La pubblicazione richiede il permesso di sviluppo.');
    const permissions = Object.fromEntries(DEVELOPMENT_CAPABILITIES.map(key => [key, body.permissions[key]]));
    const { error } = await auth.admin.rpc('set_ai_development_permissions', { p_admin: auth.profile.id, p_user: body.userId, p_permissions: permissions });
    if (error) throw error;
  }
  const [users, permissions] = await Promise.all([
    auth.admin.from('utenti').select('id,nome,cognome,attivo,ruoli(amministratore_workspace)').eq('attivo', true).order('nome'),
    auth.admin.from('ai_development_permissions').select('user_id,develop,publish,browser,database'),
  ]);
  if (users.error || permissions.error) throw users.error || permissions.error;
  return { users: users.data, permissions: permissions.data };
}

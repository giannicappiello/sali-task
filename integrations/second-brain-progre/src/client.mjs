export function validateConfig(config) {
  const workspace = new URL(config.workspaceUrl), supabase = new URL(config.supabaseUrl);
  if (workspace.origin !== 'https://workspace.progre.it' || workspace.pathname !== '/' || workspace.username || workspace.password) throw new Error('Destinazione Workspace non valida.');
  if (supabase.protocol !== 'https:' || !supabase.hostname.endsWith('.supabase.co') || supabase.pathname !== '/' || supabase.username || supabase.password) throw new Error('Progetto Supabase non valido.');
  if (typeof config.supabaseAnonKey !== 'string' || config.supabaseAnonKey.length < 20) throw new Error('Chiave pubblica Supabase mancante.');
  // Never accept privileged keys in a desktop client.
  if (config.supabaseAnonKey.startsWith('sb_secret_')) throw new Error('Usare solo una chiave pubblica Supabase.');
  try {
    const payload = JSON.parse(Buffer.from(config.supabaseAnonKey.split('.')[1], 'base64url').toString());
    if (payload.role !== 'anon') throw new Error('Chiave Supabase privilegiata vietata.');
  } catch (error) { if (!config.supabaseAnonKey.startsWith('sb_publishable_')) throw error; }
  return config;
}
export function createClient(config, vault, transport = fetch) {
  validateConfig(config);
  async function authRequest(grant, payload) {
    const response = await transport(`${config.supabaseUrl}/auth/v1/token?grant_type=${grant}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000),
      headers: { apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(response.status === 400 || response.status === 401 ? 'Login Workspace non riuscito. Verificare credenziali o autenticazione aggiuntiva.' : 'Autenticazione Workspace non disponibile.');
    const result = await response.json();
    if (!result.access_token || !result.refresh_token || !result.user?.id) throw new Error('Risposta di autenticazione incompleta.');
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + result.expires_in * 1000, userId: result.user.id, email: result.user.email };
  }
  async function token() {
    return vault.withLock(async () => {
      let session = await vault.read();
      if (!session) throw new Error('Collega il tuo utente Workspace con BRAIN_LOGIN. Non inviare credenziali in chat.');
      if (session.expiresAt < Date.now() + 90000) {
        const refreshed = await authRequest('refresh_token', { refresh_token: session.refreshToken });
        if (refreshed.userId !== session.userId) throw new Error('Identita della sessione cambiata. Ripetere il login.');
        session = refreshed; await vault.save(session);
      }
      return session.accessToken;
    });
  }
  async function request(body, accessToken) {
    const response = await transport(`${config.workspaceUrl}/api/mexal/automation?route=second-brain`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(360000),
      headers: { Authorization: `Bearer ${accessToken || await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let result; try { result = await response.json(); } catch { throw new Error('Second Brain non disponibile nel backend Workspace.'); }
    if (!response.ok || result.success !== true) throw new Error(result.error || `Second Brain: HTTP ${response.status}.`);
    return result;
  }
  return { request,
    login: async (email, password) => {
      const session = await authRequest('password', { email, password });
      // Verify the actual Workspace identity and AI entitlement before saving.
      const result = await request({ action: 'catalog' }, session.accessToken);
      await vault.withLock(() => vault.save(session));
      return { identity: result.identity };
    },
    logout: () => vault.withLock(() => vault.remove()),
  };
}

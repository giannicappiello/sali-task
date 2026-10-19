export function adminAuthFailure(error) {
  const providerStatus = Number(error?.status) || 0;
  const unavailable = providerStatus === 429 || providerStatus >= 500 || error?.name === 'AuthRetryableFetchError';
  const code = /^[a-z0-9_]{1,80}$/i.test(error?.code || '') ? error.code : 'unknown';
  // Never include tokens, passwords, account details or provider messages.
  console.warn('[admin-manage-user:auth]', { providerStatus, code });
  return {
    status: unavailable ? 503 : 401,
    body: { error: unavailable
      ? 'Servizio di autenticazione temporaneamente non disponibile. Riprova tra poco.'
      : 'Sessione scaduta. Accedi nuovamente e riprova il salvataggio.' },
  };
}

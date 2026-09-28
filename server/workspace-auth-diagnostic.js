// Never log tokens, user data or provider messages: they can contain credentials.
export function workspaceAuthFailure(error, context, message) {
  const providerStatus = Number(error?.status) || 0;
  const code = /^[a-z0-9_]{1,80}$/i.test(error?.code || '') ? error.code : 'unknown';
  console.warn('[workspace-auth]', { context, providerStatus, code });
  const unavailable = providerStatus === 429 || providerStatus >= 500 || error?.name === 'AuthRetryableFetchError';
  return Object.assign(new Error(unavailable
    ? 'Servizio di autenticazione temporaneamente non disponibile. Riprova tra poco.'
    : message), { status: unavailable ? 503 : 401 });
}

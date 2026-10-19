const SESSION_MESSAGE = "Sessione scaduta. Accedi nuovamente e riprova il salvataggio.";

function failure(message, status) {
  return { data: null, error: Object.assign(new Error(message), { status }) };
}

function sessionFailure(error) {
  const status = Number(error?.status);
  return status === 429 || status >= 500 || error?.name === 'AuthRetryableFetchError'
    ? failure("Servizio di autenticazione temporaneamente non disponibile. Riprova tra poco.", 503)
    : failure(SESSION_MESSAGE, 401);
}

// Retry only an authentication rejection, which precedes all user mutations.
// Never replay a network failure or an ambiguous server error after a write.
export async function invokeAdminUser(client, options) {
  try {
    const initial = await client.auth.getSession();
    if (initial.error) return sessionFailure(initial.error);
    let session = initial.data?.session;
    if (!session?.access_token) return failure(SESSION_MESSAGE, 401);
    const callerId = session.user?.id;
    const refresh = async () => {
      const result = await client.auth.refreshSession();
      if (result.error) return sessionFailure(result.error);
      if (!result.data?.session?.access_token || result.data.session.user?.id !== callerId) return failure(SESSION_MESSAGE, 401);
      session = result.data.session;
      return null;
    };
    if (session.expires_at && session.expires_at * 1000 <= Date.now() + 60000) {
      const error = await refresh();
      if (error) return error;
    }
    const invoke = () => client.functions.invoke('admin-manage-user', {
      ...options, headers: { ...options?.headers, Authorization: 'Bearer ' + session.access_token },
    });
    let result = await invoke();
    if (Number(result.error?.context?.status ?? result.error?.status) === 401) {
      const error = await refresh();
      if (error) return error;
      result = await invoke();
      if (Number(result.error?.context?.status ?? result.error?.status) === 401) return failure(SESSION_MESSAGE, 401);
    }
    return result;
  } catch (error) {
    return { data: null, error };
  }
}

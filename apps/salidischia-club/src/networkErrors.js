export function isConnectionError(error) {
  const status = Number(error?.status);
  if ([401, 403, 409, 422, 429].includes(status)) return false;
  if ([408, 502, 503, 504, 520, 521, 522, 523, 524].includes(status)) return true;
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed|err_network|err_internet|connection (?:closed|reset|refused)|network connection|timed?\s*out/i.test([error?.message, error?.details].filter(Boolean).join(' '));
}

export function connectionMessage(error) {
  return isConnectionError(error) ? 'Connessione al servizio momentaneamente non disponibile. Riprova tra poco.' : error?.message || 'Operazione non riuscita. Controlla la connessione e riprova.';
}

// Preserve the normal Supabase transport and auth. Only automatic GPS
// observations need to survive the document closing after the first reading.
export function attendanceRpcFetch(input, init, fetcher = globalThis.fetch) {
  const url = typeof input === 'string' ? input : input?.url || String(input);
  const observationEndpoint = /\/rest\/v1\/rpc\/workspace_hr_(?:location_punch|punch)(?:\?|$)/.test(url);
  let observe = false;
  if (observationEndpoint && typeof init?.body === 'string') {
    try { observe = JSON.parse(init.body).p_action === 'observe'; } catch { /* Let the server validate malformed bodies. */ }
  }
  return fetcher(input, observe ? { ...init, keepalive: true } : init);
}

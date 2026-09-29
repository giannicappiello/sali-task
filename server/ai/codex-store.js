import { randomUUID } from 'node:crypto';

const unwrap = result => { if (result.error) throw result.error; return result.data; };
export const codexFailure = (message, status = 409) => Object.assign(new Error(message), { status });

export function codexStore(auth) {
  const db = auth.admin, user = auth.profile.id;
  return {
    async run(id) {
      const row = unwrap(await db.from('ai_codex_runs').select('*').eq('id', id).eq('user_id', user).maybeSingle());
      if (!row) throw codexFailure('Lavoro Codex non trovato.', 404);
      return row;
    },
    async pending(conversationId) {
      return unwrap(await db.from('ai_codex_runs').select('id,state,request,updated_at').eq('conversation_id', conversationId).eq('user_id', user).eq('state', 'pending').maybeSingle());
    },
    async start(conversationId, id, request) {
      return unwrap(await db.rpc('start_workspace_codex_run', { p_user: user, p_conversation: conversationId, p_run: id, p_request: request }));
    },
    async claim(id) {
      const lease = randomUUID();
      const run = unwrap(await db.rpc('claim_workspace_codex_run', { p_user: user, p_run: id, p_lease: lease }));
      return run ? { run, lease } : null;
    },
    async saveRun(id, lease, patch) {
      const row = unwrap(await db.from('ai_codex_runs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user).eq('lease_id', lease).select('id').maybeSingle());
      if (!row) throw codexFailure('La sessione Codex è già gestita da un’altra richiesta.');
    },
    async release(id, lease) {
      unwrap(await db.from('ai_codex_runs').update({ lease_id: null, lease_until: null }).eq('id', id).eq('user_id', user).eq('lease_id', lease));
    },
    async session(conversationId) {
      return unwrap(await db.from('ai_codex_sessions').select('*').eq('conversation_id', conversationId).eq('user_id', user).single());
    },
    async saveSession(conversationId, patch) {
      unwrap(await db.from('ai_codex_sessions').update({ ...patch, updated_at: new Date().toISOString() }).eq('conversation_id', conversationId).eq('user_id', user));
    },
    async call(runId, callId) {
      return unwrap(await db.from('ai_codex_calls').select('*').eq('run_id', runId).eq('call_id', callId).maybeSingle());
    },
    async beginCall(runId, action) {
      unwrap(await db.from('ai_codex_calls').insert({ run_id: runId, call_id: action.call_id, turn_id: action.turn_id, name: action.name, arguments: action.arguments }));
    },
    async endCall(runId, callId, outcome) {
      unwrap(await db.from('ai_codex_calls').update({ outcome }).eq('run_id', runId).eq('call_id', callId));
    },
    async calls(runId) {
      return unwrap(await db.from('ai_codex_calls').select('*').eq('run_id', runId).order('created_at'));
    },
    async finish(runId, lease, response, metadata, usage) {
      return unwrap(await db.rpc('finish_workspace_codex_run', { p_user: user, p_run: runId, p_lease: lease, p_response: response, p_metadata: metadata, p_usage: usage }));
    },
  };
}

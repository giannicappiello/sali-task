import { codexModel, createCodexClient, extractCodexText } from './codex-agent.js';
import { codexFailure } from './codex-store.js';

// Only the authenticated maintenance route calls this fixed, data-free probe.
// No caller-provided instructions or business tools enter the provider session.
export async function probeCodex({ client = createCodexClient(), now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let sessionId;
  try {
    const session = await client.create({
      agent: { model: codexModel(), instructions: 'Call workspace_connection_check exactly once, then reply with its output verbatim.',
        tools: [{ type: 'function', name: 'workspace_connection_check', description: 'Check this isolated test connection.', parameters: { type: 'object', properties: {}, additionalProperties: false } }],
        reasoning: { effort: 'low' }, multi_agent: { enabled: false } },
      environment: { type: 'none' }, input: [{ role: 'user', content: [{ type: 'input_text', text: 'Check the connection.' }] }],
    });
    sessionId = session.id;
    if (!sessionId) throw codexFailure('Test Codex senza sessione.', 502);
    const started = now(); let toolChecked = false;
    while (now() - started < 45000) {
      const state = await client.get(sessionId);
      for (const action of state.required_actions || []) {
        if (action.type !== 'function_call' || action.name !== 'workspace_connection_check') throw codexFailure('Azione inattesa nel test Codex.', 502);
        await client.send(sessionId, [{ type: 'agent.session.input.tool_result', turn_id: action.turn_id, call_id: action.call_id, success: true, output: 'CODEX_OK' }]);
        toolChecked = true;
      }
      const turn = (await client.turns(sessionId)).data?.find(item => !item.subagent_id);
      if (turn?.status === 'completed') {
        const answer = extractCodexText(await client.items(sessionId, turn.id), 'final_answer');
        if (!toolChecked || !answer.includes('CODEX_OK')) throw codexFailure('Verifica del ciclo strumenti Codex non riuscita.', 502);
        return { connected: true, model: codexModel(), toolRoundtrip: true };
      }
      if (['failed', 'cancelled'].includes(turn?.status) || state.status === 'failed') throw codexFailure('Il test Codex non è terminato correttamente.', 502);
      await wait(1000);
    }
    throw codexFailure('Tempo di verifica Codex esaurito.', 504);
  } finally {
    if (sessionId) await client.delete(sessionId);
  }
}

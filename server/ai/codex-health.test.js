import test from 'node:test';
import assert from 'node:assert/strict';
import { probeCodex } from './codex-health.js';

test('maintenance probe checks a real tool roundtrip and deletes its isolated session', async () => {
  let sent = false, deleted = false;
  const client = {
    create: async body => { assert.equal(body.agent.tools.length, 1); assert.equal(body.environment.type, 'none'); return { id: 'probe' }; },
    get: async () => ({ required_actions: [{ type: 'function_call', name: 'workspace_connection_check', call_id: 'call', turn_id: 'turn' }] }),
    send: async (id, events) => { assert.equal(events[0].output, 'CODEX_OK'); sent = true; },
    turns: async () => ({ data: [{ id: 'turn', status: 'completed' }] }),
    items: async () => [{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'CODEX_OK' }] }],
    delete: async () => { deleted = true; },
  };
  assert.equal((await probeCodex({ client })).connected, true);
  assert.equal(sent, true); assert.equal(deleted, true);
});

test('maintenance probe refuses unexpected tools and still deletes its session', async () => {
  let deleted = false;
  const client = { create: async () => ({ id: 'probe' }), get: async () => ({ required_actions: [{ type: 'function_call', name: 'MES_WRITE' }] }), delete: async () => { deleted = true; } };
  await assert.rejects(probeCodex({ client }), /Azione inattesa/);
  assert.equal(deleted, true);
});

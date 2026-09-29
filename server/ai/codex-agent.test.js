import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonSchema } from 'ai';
import { createCodexClient, codexToolDefinitions, executeCodexCall, driveCodexRun, codexInput } from './codex-agent.js';
import { boundedHistory, boundedPlanningState, codexRequestContext } from './codex-budget.js';

const schema = jsonSchema({ type: 'object', required: ['orderId'], additionalProperties: false, properties: { orderId: { type: 'integer', minimum: 1 } } });
const action = { type: 'function_call', name: 'MES_READ', arguments: { orderId: 5372 }, turn_id: 'turn_1', call_id: 'call_1' };

function fixture() {
  const run = { id: 'run_1', conversation_id: 'conv_1', state: 'pending', phase: 'new', request: { prompt: 'Ricalcola la fusione e prepara la conferma.' } };
  const calls = new Map(); let session = {}; let claimed = false; let writes = 0;
  const store = {
    run, callsMap: calls,
    claim: async () => claimed ? null : (claimed = true, { run, lease: 'lease' }),
    release: async () => { claimed = false; },
    saveRun: async (id, lease, patch) => Object.assign(run, patch),
    session: async () => session,
    saveSession: async (id, patch) => { session = { ...session, ...patch }; },
    call: async (id, callId) => calls.get(callId),
    beginCall: async (id, item) => calls.set(item.call_id, { ...item }),
    endCall: async (id, callId, outcome) => { calls.get(callId).outcome = outcome; },
    calls: async () => [...calls.values()],
    finish: async (id, lease, response) => { run.response = response; run.state = 'completed'; writes++; return response; },
    get writes() { return writes; },
  };
  return { store, run };
}

test('REST client uses the managed Codex endpoint and agent beta header; paginates items', async () => {
  const requests = [];
  const client = createCodexClient({ apiKey: 'test-only', transport: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => url.includes('after=') ? { data: [{ id: 'second', turn_id: 'turn_1' }], has_more: false } : { data: [{ id: 'old', turn_id: 'turn_old' }, { id: 'first', turn_id: 'turn_1' }], has_more: true, last_id: 'first' } };
  } });
  assert.equal((await client.items('sess_1', 'turn_1')).length, 2);
  assert.match(requests[0].url, /^https:\/\/api.openai.com\/v1\/agents\/sessions\/sess_1\/items\?order=asc/);
  assert.equal(requests[0].options.headers['OpenAI-Beta'], 'agents=v1');
  assert.match(requests[1].url, /after=first/);
});

test('tool results survive disconnect and are not executed twice', async () => {
  const { store, run } = fixture(); let executions = 0;
  const tools = { MES_READ: { inputSchema: schema, execute: async () => ({ quantity: ++executions }) } };
  const definitions = await codexToolDefinitions(tools);
  const first = await executeCodexCall({ store, run, action, tools, definitions });
  const second = await executeCodexCall({ store, run, action, tools, definitions });
  assert.deepEqual(second, first); assert.equal(executions, 1);
});

test('unknown tool and schema-invalid arguments never reach an executor', async () => {
  const { store, run } = fixture(); let executions = 0;
  const tools = { MES_READ: { inputSchema: schema, execute: async () => executions++ } };
  const definitions = await codexToolDefinitions(tools);
  for (const [name, args] of [['MES_READ', { orderId: -1 }], ['MES_WRITE', { orderId: 5372 }], ['constructor', {}]]) {
    const result = await executeCodexCall({ store, run, action: { ...action, name, arguments: args, call_id: name }, tools, definitions });
    assert.equal(result.success, false);
  }
  assert.equal(executions, 0);
});

test('uncertain execution is reported for diagnosis without retrying the operation', async () => {
  const { store, run } = fixture(); let executions = 0;
  await store.beginCall(run.id, action);
  const tools = { MES_READ: { inputSchema: schema, execute: async () => executions++ } };
  const outcome = await executeCodexCall({ store, run, action, tools, definitions: await codexToolDefinitions(tools) });
  assert.equal(outcome.success, false); assert.match(outcome.error, /NON viene ripetuta/); assert.equal(executions, 0);
});

test('managed turn continues from materials diagnosis to refreshed preview and confirmation proposal', async () => {
  const { store, run } = fixture(); let step = 0; let created = 0;
  const sequence = ['MES_PRIORITY_MATERIALS', 'MES_PLAN_MERGE_PREVIEW', 'MES_PLAN_APPLY'];
  const output = [{ reserved: 0, missing: 68.04 }, { totalNeed: 5.4, blocks: [] }, { changed: false, controlledAction: { id: 'proposal_1' } }];
  const tools = Object.fromEntries(sequence.map((name, i) => [name, { inputSchema: schema, execute: async () => output[i] }]));
  const client = {
    create: async input => { created++; assert.equal(input.environment.type, 'none'); assert.equal(input.agent.multi_agent.enabled, false); return { id: 'sess_1' }; },
    get: async () => ({ status: step < 3 ? 'requires_action' : 'idle', required_actions: step < 3 ? [{ ...action, name: sequence[step], call_id: `call_${step}` }] : [] }),
    turns: async () => ({ data: [{ id: 'turn_1', subagent_id: null, status: step < 3 ? 'waiting' : 'completed', usage: { input_tokens: 100, output_tokens: 20 } }] }),
    send: async (id, events) => { assert.equal(events[0].type, 'agent.session.input.tool_result'); step++; },
    items: async () => [{ type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Verifico' }] }, { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Anteprima aggiornata. Conferma la proposta.' }] }],
  };
  const finalize = async ({ text, calls, usage }) => {
    assert.equal(calls.length, 3); assert.equal(usage.input, 100);
    return { response: { answer: text }, metadata: {} };
  };
  const result = await driveCodexRun({ store, run, tools, instructions: 'test', client, finalize, wait: async () => {} });
  assert.match(result.answer, /Anteprima aggiornata/); assert.equal(created, 1); assert.equal(store.writes, 1);
  assert.deepEqual(await driveCodexRun({ store, run, tools, instructions: 'test', client, finalize }), result);
  assert.equal(store.writes, 1);
});

test('bounded requests resume the same session and do not resubmit the user message', async () => {
  const { store, run } = fixture(); let created = 0; let completed = false;
  const client = {
    create: async () => { created++; return { id: 'sess_1' }; },
    get: async () => ({ status: completed ? 'idle' : 'active' }),
    turns: async () => ({ data: [{ id: 'turn_1', status: completed ? 'completed' : 'in_progress' }] }),
    items: async () => [{ type: 'message', role: 'assistant', phase: completed ? 'final_answer' : 'commentary', content: [{ type: 'output_text', text: completed ? 'Verificato.' : 'Controllo i dati.' }] }],
    send: async () => assert.fail('must not resubmit'),
  };
  const params = { store, run, tools: {}, instructions: 'test', client, sliceMs: 0, finalize: async ({ text }) => ({ response: { answer: text }, metadata: {} }) };
  const pending = await driveCodexRun(params);
  assert.equal(pending.pending, true); assert.equal(created, 1);
  completed = true;
  assert.equal((await driveCodexRun(params)).answer, 'Verificato.'); assert.equal(created, 1);
});

test('an idle session without a completed turn cannot be reported as successful', async () => {
  const { store, run } = fixture();
  const result = await driveCodexRun({ store, run, tools: {}, instructions: '', sliceMs: 0,
    client: { create: async () => ({ id: 's' }), get: async () => ({ status: 'idle' }), turns: async () => ({ data: [] }) },
    finalize: async () => assert.fail('not complete'),
  });
  assert.equal(result.pending, true); assert.equal(store.writes, 0);
});

test('changed tool scope cancels an existing pending turn before executing tools', async () => {
  const { store, run } = fixture(); let cancelled = false;
  Object.assign(run, { phase: 'running', session_id: 's' });
  await store.saveSession('conv_1', { session_id: 's', configuration_hash: 'old-scope' });
  await assert.rejects(driveCodexRun({ store, run, tools: {}, instructions: '',
    client: { send: async () => { cancelled = true; } }, finalize: async () => assert.fail('not complete') }), /Permessi/);
  assert.equal(cancelled, true); assert.equal(run.state, 'cancelled');
});

test('PDF is never silently sent as an unsupported Agents input', () => {
  assert.throws(() => codexInput('Read', [{ mediaType: 'application/pdf', data: new Uint8Array([1]) }]), /lettore documenti/);
});

test('new requests never inherit a bloated provider session; history and context are bounded', async () => {
  const { store, run } = fixture();
  await store.saveSession('conv_1', { session_id: 'old-heavy-session' });
  let received;
  const client = { create: async input => { received = input; return { id: 'fresh' }; },
    get: async () => ({ status: 'idle' }), turns: async () => ({ data: [] }),
    send: async () => assert.fail('must not send into old session') };
  await driveCodexRun({ store, run, tools: {}, instructions: '', client, sliceMs: 0,
    history: [{ role: 'assistant', content: 'x'.repeat(500000) }, { role: 'user', content: 'OP 5372' }] });
  assert.ok(JSON.stringify(received).length < 20000);
  assert.match(JSON.stringify(received), /OP 5372/);
  assert.match(JSON.stringify(received), /omittedMessages/);
});

test('oversized initial input is rejected before any paid provider request', async () => {
  const { store, run } = fixture();
  await assert.rejects(driveCodexRun({ store, run, tools: {}, instructions: '', context: { huge: 'x'.repeat(250000) },
    client: { create: async () => assert.fail('must not spend') } }), /Limite preventivo/);
  assert.equal(run.state, 'cancelled');
});

test('oversized tool output is saved intact but never sent; the operation is not repeated', async () => {
  const { store, run } = fixture(); let executions = 0; const events = [];
  const tools = { MES_READ: { inputSchema: schema, execute: async () => { executions++; return { large: 'x'.repeat(30000) }; } } };
  const client = { create: async () => ({ id: 's' }), get: async () => ({ required_actions: [action] }),
    turns: async () => ({ data: [{ id: 'turn_1', status: 'waiting' }] }), send: async (id, input) => events.push(...input) };
  await assert.rejects(driveCodexRun({ store, run, tools, instructions: '', client }), /risultato MES_READ troppo esteso/);
  assert.equal(executions, 1);
  assert.ok((await store.calls(run.id))[0].outcome.output.length > 30000);
  assert.deepEqual(events.map(event => event.type), ['agent.session.input.cancel']);
  await assert.rejects(driveCodexRun({ store, run, tools, instructions: '', client }), /Limite preventivo/);
  assert.equal(executions, 1);
});

test('planning pages disclose omissions and retain selected order data without version snapshots', () => {
  const state = { configuration: { active: true }, demands: [{ productionOrderId: 1 }, { productionOrderId: 2 }],
    versions: [{ id: 'v1', snapshot: { huge: 'x'.repeat(500000) }, expectedHash: 'hash' }, { id: 'v2' }] };
  const page = boundedPlanningState(state, { orderId: 2, limit: 1 });
  assert.deepEqual(page.demands, [{ productionOrderId: 2 }]);
  assert.equal(page.versions[0].snapshot, undefined);
  assert.equal(page.versions[0].expectedHash, 'hash');
  assert.equal(page.pagination.versions.nextOffset, 1);
  assert.equal(state.versions[0].snapshot.huge.length, 500000);
  assert.equal(boundedHistory([{ content: 'x'.repeat(17000) }]).omittedMessages, 1);
  const context = codexRequestContext({ profile: { id: 'u' }, capabilities: {}, access: { modules: ['progremes'] } }, null);
  assert.equal(context.progremes, undefined);
});

test('tool-call ceiling stops before the thirteenth operation, across continuation slices', async () => {
  const { store, run } = fixture(); let calls = 0;
  const tools = { MES_READ: { inputSchema: schema, execute: async () => ({ value: ++calls }) } };
  const client = { create: async () => ({ id: 's' }),
    get: async () => ({ required_actions: [{ ...action, call_id: `call_${calls}` }] }),
    turns: async () => ({ data: [{ id: 'turn_1', status: 'waiting' }] }), send: async () => {} };
  const options = { store, run, tools, instructions: '', client, sliceMs: 0 };
  for (let i = 0; i < 12; i++) assert.equal((await driveCodexRun(options)).pending, true);
  await assert.rejects(driveCodexRun(options), /12 chiamate/);
  assert.equal(calls, 12);
  assert.equal(run.state, 'cancelled');
});

test('cumulative result ceiling stops even when every individual result is small', async () => {
  const { store, run } = fixture(); let calls = 0;
  const tools = { MES_READ: { inputSchema: schema, execute: async () => { calls++; return { data: 'x'.repeat(22000) }; } } };
  const client = { create: async () => ({ id: 's' }),
    get: async () => ({ required_actions: [{ ...action, call_id: `call_${calls}` }] }),
    turns: async () => ({ data: [{ id: 'turn_1', status: 'waiting' }] }), send: async () => {} };
  const options = { store, run, tools, instructions: '', client, sliceMs: 0 };
  for (let i = 0; i < 4; i++) await driveCodexRun(options);
  await assert.rejects(driveCodexRun(options), /troppo esteso/);
  assert.equal(calls, 5);
});

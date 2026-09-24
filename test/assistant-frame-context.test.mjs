import test from 'node:test';
import assert from 'node:assert/strict';
import { requestAssistantFrameContext, captureWithMesFrame, captureFromMesParent } from '../src/lib/assistantFrameContext.js';

function fixture() {
  const listeners = new Set();
  const browser = { crypto: { randomUUID: () => 'request-1' }, setTimeout, clearTimeout,
    addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  const target = { postMessage(data, origin) { this.sent = { data, origin }; } };
  const emit = overrides => { for (const fn of listeners) fn({ origin: 'https://mes.example', source: target,
    data: { type: 'workspace-ai-context-response', requestId: 'request-1', context: { system: 'mes', surface: 'popup', visibleSummary: 'RDP29 Batch 1 MP2066', recordId: '5444' } }, ...overrides }); };
  return { browser, target, emit, listeners };
}
test('context bridge accepts only expected frame, origin and request; removes listener', async () => {
  const f = fixture();
  const pending = requestAssistantFrameContext({ ...f, origin: 'https://mes.example' });
  f.emit({ source: {} }); f.emit({ origin: 'https://evil.example' });
  f.emit({ data: { type: 'workspace-ai-context-response', requestId: 'stale' } });
  assert.equal(f.listeners.size, 1);
  f.emit();
  assert.equal((await pending).recordId, '5444');
  assert.equal(f.listeners.size, 0);
  assert.equal(f.target.sent.origin, 'https://mes.example');
});
test('missing/old MES context times out and cleans listener', async () => {
  const f = fixture();
  assert.equal(await requestAssistantFrameContext({ ...f, origin: 'https://mes.example', timeoutMs: 5 }), null);
  assert.equal(f.listeners.size, 0);
});
test('Workspace popup wins over the underlying MES iframe', async () => {
  const popup = { surface: 'popup', recordId: 'task-12' };
  assert.equal(await captureWithMesFrame(popup, { querySelectorAll() { throw Error('must not inspect MES'); } }, {}), popup);
});
test('embedded assistant explicitly reports old MES protocol instead of empty selection', async () => {
  const context = await captureFromMesParent({ system: 'mes' }, { parent: {}, location: { search: '?embedded=mes' } });
  assert.match(context.contextUnavailable, /Aggiornare MES/);
});

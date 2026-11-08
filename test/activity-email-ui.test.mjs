import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { transformWithOxc } from 'vite';

const window = new Window({ url: 'http://localhost' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'MouseEvent', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const require = createRequire(import.meta.url);
let source = await readFile(new URL('../src/components/ActivityEmailPanel.jsx', import.meta.url), 'utf8');
source = source.replace(/import \{ activityEmailRequest \}[^;]+;/, 'const activityEmailRequest = () => { throw new Error("Unexpected real API request"); };').replace(/import '\.\/activity-email-panel.css';/, '');
const transformed = await transformWithOxc(source, 'ActivityEmailPanel.jsx', { jsx: { runtime: 'automatic' } });
const code = transformed.code.replace(/(["'])(react(?:\/jsx-runtime)?)\1/g, (_, quote, specifier) => JSON.stringify(pathToFileURL(require.resolve(specifier)).href));
const { default: Panel } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const email = { id: 'mail-1', recipient: 'recipient@example.com', subject: 'Sollecito', body: 'Testo completo\nSeconda riga', status: 'proposed' };
const context = (emails = [], permissions = { canPropose: true, canConfirm: true }) => ({ success: true, emails, permissions });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
let host, root;
async function mount(request, taskId = 'task-1') {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(React.createElement(Panel, { taskId, request })); await settle(); });
}
async function cleanup() { if (root) await act(async () => root.unmount()); host?.remove(); root = null; }
const button = text => [...host.querySelectorAll('button')].find(node => node.textContent === text);
async function click(text, twice = false) {
  await act(async () => { const node = button(text); assert.ok(node, text); node.click(); if (twice) node.click(); await settle(); });
}
async function fill() {
  await act(async () => {
    const nodes = [...host.querySelectorAll('.activity-email-compose input'), host.querySelector('textarea')];
    const values = [email.recipient, email.subject, email.body];
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      const proto = node.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, values[index]);
      node.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
  });
}

test('proposal never sends; canonical review requires explicit confirmation and prevents duplicate clicks', async () => {
  const calls = [];
  const request = async input => {
    calls.push(input);
    if (input.action === 'context') return context();
    if (input.action === 'propose') return { success: true, email };
    if (input.action === 'confirmation') return { success: true, email: { ...email, body: 'Canonical server text' }, receipt: 'receipt-1' };
    if (input.action === 'decide') return { success: true, email: { ...email, status: 'queued' } };
    throw new Error('Unexpected action');
  };
  try {
    await mount(request); await fill(); await click('Prepara proposta (non invia)', true);
    assert.equal(calls.filter(c => c.action === 'propose').length, 1);
    assert.equal(calls.filter(c => c.action === 'decide').length, 0);
    assert.ok(calls.find(c => c.action === 'propose').idempotencyKey);
    await click('Verifica proposta');
    assert.match(host.querySelector('.activity-email-review').textContent, /Canonical server text/);
    assert.equal(document.activeElement.tagName, 'H4');
    await click('Conferma e invia', true);
    assert.deepEqual(calls.filter(c => c.action === 'decide'), [{ action: 'decide', receipt: 'receipt-1', decision: 'confirm' }]);
    assert.match(host.textContent, /Confermata, in coda/);
  } finally { await cleanup(); }
});

test('proposal timeout preserves draft, refreshes read-only history and never retries', async () => {
  const calls = [];
  const request = async input => {
    calls.push(input);
    if (input.action === 'context' || input.action === 'history') return context();
    throw new Error('Timeout simulato');
  };
  try {
    await mount(request); await fill(); await click('Prepara proposta (non invia)');
    assert.equal(host.querySelector('textarea').value, email.body);
    assert.match(host.textContent, /potrebbe essere stata salvata/);
    assert.equal(host.querySelector('fieldset').disabled, true);
    await click('Aggiorna storico');
    assert.equal(calls.filter(c => c.action === 'propose').length, 1);
    assert.equal(calls.filter(c => c.action === 'history').length, 1);
    assert.equal(calls.filter(c => c.action === 'decide').length, 0);
  } finally { await cleanup(); }
});

test('uncertain confirmation disables repeating the decision even after history refresh', async () => {
  const calls = [];
  const request = async input => {
    calls.push(input);
    if (input.action === 'context' || input.action === 'history') return context([email]);
    if (input.action === 'confirmation') return { success: true, email, receipt: 'receipt-1' };
    throw new Error('Timeout simulato');
  };
  try {
    await mount(request); await click('Verifica proposta'); await click('Conferma e invia');
    assert.equal(host.querySelector('.activity-email-review'), null);
    assert.equal(button('Verifica proposta').disabled, true);
    await click('Aggiorna storico');
    assert.equal(button('Verifica proposta').disabled, true);
    assert.equal(calls.filter(c => c.action === 'decide').length, 1);
  } finally { await cleanup(); }
});

test('AI proposals route to AI review; server permissions govern manual actions', async () => {
  try {
    await mount(async () => context([{ ...email, via_ai: true }], { canPropose: false, canConfirm: true }));
    assert.equal(host.querySelector('fieldset'), null);
    assert.equal(button('Verifica proposta'), undefined);
    assert.match(host.querySelector('a').href, /assistente-ai\?view=review&kind=email&proposalId=mail-1/);
  } finally { await cleanup(); }
});

test('closing or navigating aborts and ignores late context and mutation results', async () => {
  let resolveOld, oldSignal;
  const request = (input, { signal }) => {
    if (input.taskId === 'task-old') { oldSignal = signal; return new Promise(resolve => { resolveOld = resolve; }); }
    return Promise.resolve(context([{ ...email, subject: 'New task' }]));
  };
  try {
    await mount(request, 'task-old');
    await act(async () => { root.render(React.createElement(Panel, { taskId: 'task-new', request })); await settle(); });
    assert.equal(oldSignal.aborted, true);
    await act(async () => { resolveOld(context([{ ...email, subject: 'Stale task' }])); await settle(); });
    assert.match(host.textContent, /New task/); assert.doesNotMatch(host.textContent, /Stale task/);
  } finally { await cleanup(); }
});

test('same draft keeps idempotency key and Enter never submits the outer task form', async () => {
  const calls = [];
  try {
    await mount(async input => { calls.push(input); return input.action === 'propose' ? { success: true, email } : context(); });
    await fill();
    const keyEvent = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    host.querySelector('input').dispatchEvent(keyEvent);
    assert.equal(keyEvent.defaultPrevented, true);
    await click('Prepara proposta (non invia)'); await click('Prepara proposta (non invia)');
    const proposals = calls.filter(c => c.action === 'propose');
    assert.equal(proposals.length, 2); assert.equal(proposals[0].idempotencyKey, proposals[1].idempotencyKey);
  } finally { await cleanup(); }
});

test('closing a pending proposal never opens a review or sends after unmount', async () => {
  let finish, signal;
  const calls = [];
  const request = (input, options) => {
    calls.push(input);
    if (input.action === 'propose') { signal = options.signal; return new Promise(resolve => { finish = resolve; }); }
    return Promise.resolve(context());
  };
  await mount(request); await fill(); await click('Prepara proposta (non invia)');
  await cleanup(); assert.equal(signal.aborted, true);
  await act(async () => { finish({ success: true, email }); await settle(); });
  assert.equal(calls.filter(c => c.action === 'decide' || c.action === 'confirmation').length, 0);
});

test('reject requires canonical review and accepted never means delivered', async () => {
  const calls = [];
  const request = async input => {
    calls.push(input);
    if (input.action === 'context') return context([email, { ...email, id: 'accepted-2', status: 'accepted' }]);
    if (input.action === 'confirmation') return { success: true, email, receipt: 'receipt-1' };
    if (input.action === 'decide') return { success: true, email: { ...email, status: 'rejected' } };
  };
  try {
    await mount(request); assert.match(host.textContent, /Accettata dal server, consegna non verificata/);
    await click('Verifica proposta'); await click('Rifiuta proposta');
    assert.equal(calls.find(c => c.action === 'decide').decision, 'reject');
    assert.equal(button('Verifica proposta'), undefined);
  } finally { await cleanup(); }
});

test('failed context can be refreshed without sending and missing permissions fail closed', async () => {
  let attempts = 0;
  try {
    await mount(async () => { if (!attempts++) throw new Error('Connessione assente'); return context([email], {}); });
    assert.match(host.textContent, /Connessione assente/);
    await click('Aggiorna storico');
    assert.equal(host.querySelector('fieldset'), null); assert.equal(button('Verifica proposta'), undefined);
  } finally { await cleanup(); }
});

test('pagination appends unique rows and human-readable error does not expose raw details', async () => {
  try {
    await mount(async input => input.action === 'context'
      ? { ...context([email]), nextOffset: 1 }
      : { success: true, emails: [email, { ...email, id: 'failed-2', status: 'failed', error_code: 'provider_rejected' }], nextOffset: null });
    await click('Carica altre email');
    assert.equal(host.querySelectorAll('.activity-email-history>li').length, 2);
    assert.equal(button('Carica altre email'), undefined);
    assert.match(host.textContent, /Il servizio email ha rifiutato il messaggio/);
    assert.doesNotMatch(host.textContent, /provider_rejected/);
  } finally { await cleanup(); }
});

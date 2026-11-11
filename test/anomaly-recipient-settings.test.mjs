import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { transformWithOxc } from 'vite';

const window = new Window({ url: 'http://localhost' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Event']) {
 Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const require = createRequire(import.meta.url);
let source = await readFile(new URL('../src/pages/Anomalies/RecipientSettings.jsx', import.meta.url), 'utf8');
source = source.replace(/import \{ supabase \}[^;]+;/, 'const supabase = { auth: { getSession: async () => ({ data: { session: { access_token: "fixture" } } }) } };')
 .replace("'../../../shared/anomalyRecipientDepartments.js'", JSON.stringify(new URL('../shared/anomalyRecipientDepartments.js', import.meta.url).href));
const transformed = await transformWithOxc(source, 'RecipientSettings.jsx', { jsx: { runtime: 'automatic' } });
const code = transformed.code.replace(/(["'])(react(?:\/jsx-runtime)?)\1/g, (_, quote, specifier) => JSON.stringify(pathToFileURL(require.resolve(specifier)).href));
const { default: Settings } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const excluded = ['Beauty Consultant', 'Cliente Private', 'Field Force Estero', 'Field Force Farmacia', 'Field Force Professional'];
const users = [{ id: 'a', nome: 'Anna', cognome: 'Rossi', email: 'anna@example.test' }, { id: 'b', nome: 'Bruno', cognome: 'Verdi', email: 'bruno@example.test' }];

test('additional recipients start empty, require explicit addition, support removal and submit only chosen IDs', async () => {
 const host = document.createElement('div'); document.body.append(host);
 const root = createRoot(host), requests = [];
 const originalFetch = globalThis.fetch;
 globalThis.fetch = async (url, options) => { requests.push(JSON.parse(options.body)); return Response.json({ reviewUrl: '/review' }); };
 const button = text => [...host.querySelectorAll('button')].find(node => node.textContent === text);
 const click = async text => act(async () => button(text).click());
 const submit = async () => act(async () => host.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
 try {
  await act(async () => root.render(React.createElement(Settings, {
   agent: { recipient_policy: { departmentManager: true, workspaceAdmins: true, departmentOverrides: {}, additionalUserIds: [] }, enabled: false, config_version: 1 },
   configuration: { users, departments: [...excluded, 'Produzione'].map((nome, id) => ({ id: String(id), nome })) },
  })));
  const field = host.querySelector('fieldset'), select = field.querySelector('select');
  assert.match(field.textContent, /Nessun destinatario aggiuntivo/);
  assert.equal(field.querySelectorAll('li').length, 0);
  assert.equal(select.value, '');
  assert.equal(button('Aggiungi destinatario').disabled, true);
  for (const name of excluded) assert(!host.textContent.includes(name));
  assert.match(host.textContent, /Produzione · responsabile per i report/);
  await submit(); assert.deepEqual(requests.at(-1).recipientPolicy.additionalUserIds, []);
  await act(async () => { select.value = 'a'; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
  assert.equal(field.querySelectorAll('li').length, 0);
  await click('Aggiungi destinatario');
  assert.equal(field.querySelectorAll('li').length, 1);
  assert.match(field.querySelector('li').textContent, /Anna Rossi/);
  assert.equal(select.value, ''); assert(![...select.options].some(option => option.value === 'a'));
  await submit(); assert.deepEqual(requests.at(-1).recipientPolicy.additionalUserIds, ['a']);
  await click('Rimuovi'); assert.equal(field.querySelectorAll('li').length, 0);
  await act(async () => { select.value = 'b'; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
  await click('Aggiungi destinatario'); await click('Rimuovi tutti');
  await submit(); assert.deepEqual(requests.at(-1).recipientPolicy.additionalUserIds, []);
 } finally { await act(async () => root.unmount()); host.remove(); globalThis.fetch = originalFetch; }
});

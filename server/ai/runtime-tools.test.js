/* global process, Buffer */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasDevelopmentPermission, manageDevelopmentPermissions } from './development-permissions.js';
import { runtimeTools, validateBrowserRequest, requestJobMigrations, requestRuntimeOperation, sealBrowserSession, openBrowserSession } from './runtime-tools.js';
import { requestDevelopmentJob } from './development-jobs.js';
import { executeDatabase, browserUrl, verifyBrowser } from '../../hosting/ai-development/runtime.mjs';

test('development capabilities default off, admin complete, explicit grants stay separate', async () => {
  const user = { profile: { ruoli: {} }, developmentPermissions: { develop: true } };
  assert.equal(hasDevelopmentPermission(user, 'develop'), true);
  assert.equal(hasDevelopmentPermission(user, 'publish'), false);
  assert.deepEqual(runtimeTools(user), {});
  assert.equal(hasDevelopmentPermission({ profile: { ruoli: { amministratore_workspace: true } } }, 'database'), true);
  await assert.rejects(requestDevelopmentJob(user, { repository: 'workspace', instruction: 'Modifica una schermata.' }), e => e.status === 403);
  await assert.rejects(manageDevelopmentPermissions(user, {}), e => e.status === 403);
  await assert.rejects(requestRuntimeOperation(user, 'database', {}), e => e.status === 403);
});

test('browser rejects external domains, deceptive URLs, arbitrary code and ambiguous operations', () => {
  for (const url of ['http://workspace.progre.it/', 'https://workspace.progre.it.evil.test/', 'file:///C:/Windows', 'https://name:password@workspace.progre.it/']) {
    assert.throws(() => validateBrowserRequest({ url, steps: [] })); assert.throws(() => browserUrl(url));
  }
  assert.throws(() => validateBrowserRequest({ url: 'https://workspace.progre.it/', steps: [{ action: 'evaluate', target: 'document.cookie' }] }));
  assert.equal(validateBrowserRequest({ url: 'https://workspace.progre.it/settings/hr', steps: [{ action: 'click', target: 'Vista mensile' }] }).steps.length, 1);
});

test('database migration requests cannot use another owner or an unpublished job', async () => {
  const filters = [];
  const query = { select: () => query, eq: (...args) => { filters.push(args); return query; }, maybeSingle: async () => ({ data: { status: 'review', repository: 'workspace' } }) };
  await assert.rejects(requestJobMigrations({ profile: { id: 'owner', ruoli: { amministratore_workspace: true } }, admin: { from: () => query } }, 'job'), e => e.status === 409);
  assert.deepEqual(filters, [['id', 'job'], ['user_id', 'owner']]);
});

test('migration runner rejects traversal and never applies the whole pending set', async () => {
  await assert.rejects(executeDatabase({ supabaseExecutable: 'cli', repositories: { workspace: { path: 'repo' } } }, { payload: { commit: 'a'.repeat(40), files: ['../unsafe.sql'] } }, () => {}, () => assert.fail('No process may start')));
});

test('browser refuses a different signed-in user and closes its isolated context', async () => {
  let closed = false;
  const page = { goto: async () => {}, locator: () => ({ waitFor: async () => {}, getAttribute: async () => 'another-user' }) };
  const chromium = { launch: async () => ({ newContext: async () => ({ newPage: async () => page, route: async () => {} }), close: async () => { closed = true; } }) };
  await assert.rejects(verifyBrowser({ outputDirectory: 'temp' }, { user_id: '00000000-0000-4000-8000-000000000000', payload: { url: 'https://workspace.progre.it/', steps: [{ action: 'click', target: 'Salva' }] } }, async () => {}, chromium), /altro utente/);
  assert.equal(closed, true);
});

test('browser handoff is encrypted, owner-bound and expires without a refresh credential', () => {
  const previous = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
  try {
    const sealed = sealBrowserSession('test-access-token', 'owner', 1000);
    assert.equal(JSON.stringify(sealed).includes('test-access-token'), false);
    assert.equal(openBrowserSession(sealed, 'owner', 2000), 'test-access-token');
    assert.throws(() => openBrowserSession(sealed, 'other', 2000));
    assert.throws(() => openBrowserSession(sealed, 'owner', 301000));
    assert.throws(() => openBrowserSession({ ...sealed, tag: Buffer.alloc(16).toString('base64') }, 'owner', 2000));
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous;
  }
});

test('database metadata queries request JSON explicitly and never write business records', async () => {
  const calls = [];
  const result = await executeDatabase({ supabaseExecutable: 'cli', repositories: { workspace: { path: 'repo' } } }, { payload: { operation: 'schema' } }, async () => {}, async (cmd, args) => {
    calls.push(args);
    assert.deepEqual(args.slice(-2), ['--output', 'json']);
    assert.match(args[3], /^select /);
    return Buffer.from(JSON.stringify(calls.length === 1 ? [{ sample: 'metadata' }] : { rows: [{ sample: 'metadata' }] }));
  });
  assert.equal(calls.length, 2);
  assert.equal(result.columns.length, 1);
});

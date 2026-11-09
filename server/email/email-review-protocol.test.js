import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSecondBrain } from '../second-brain/handler.js';
import { activityEmailRequest } from './activity-email-handler.js';
import { getActivityEmailTransport } from './activity-email-worker.js';

const id = '11111111-1111-4111-8111-111111111111';
const hash = 'a'.repeat(64);
const auth = { profile: { id }, capabilities: { internal_data: true, role_ai_level: 'conferma' }, access: { modules: ['attivita'] } };
const request = body => ({ method: 'POST', body });

for (const kind of ['manual', 'email', 'email-delegation']) {
 for (const requiredProtocol of [1, 2]) {
  test(`${kind} human review checks protocol ${requiredProtocol} before writing and preserves its receipt`, async () => {
   const checks = [], writes = [], scheduled = [];
   const row = { id, author_id: id, source_kind: kind === 'manual' ? 'activity' : 'chat', via_ai: kind !== 'manual', status: 'proposed', payload_hash: hash,
    recipient: 'one@example.invalid', to_recipients: requiredProtocol === 2 ? ['one@example.invalid', 'two@example.invalid'] : null,
    cc_recipients: requiredProtocol === 2 ? ['copy@example.invalid'] : null,
    ...(requiredProtocol === 2 ? { transport_protocol_version: 2 } : {}),
    policy_version: `chat-email-v${requiredProtocol}`, policy_hash: hash };
   let supported = [1];
   const transport = async options => {
    checks.push(options);
    return getActivityEmailTransport({ ...options,
     environment: { ARUBA_EMAIL_WORKER_URL: 'https://example.invalid/worker', ARUBA_EMAIL_WORKER_SECRET: 'fixture' },
     fetchImpl: async (_url, input) => { assert.equal(input.method, 'GET'); return Response.json({ activity_email_protocol: 1, activity_email_protocols: supported, queue_enabled: true }); },
    });
   };
   const decide = async (_auth, input) => { writes.push(input); return { ...row, status: kind === 'email-delegation' ? 'active' : 'queued' }; };
   const emailService = { getActivityEmail: async () => row, hashActivityEmail: () => hash, decideActivityEmail: decide };
   const dependencies = { authorize: async () => auth, receiptKey: 'test-key', transport, catalog: () => ({}),
    dispatch: async () => undefined, dispatchActivityEmail: async () => undefined, schedule: promise => scheduled.push(promise),
    services: emailService, emailService,
    chatService: { getChatEmail: async () => row, getChatEmailDelegation: async () => row, hashChatEmailDelegation: () => hash, decideChatEmailDelegation: decide, decideChatEmailHuman: decide },
   };
   const handler = kind === 'manual' ? activityEmailRequest : handleSecondBrain;
   const preview = await handler(request({ action: 'confirmation', ...(kind === 'manual' ? {} : { kind }), id }), dependencies);
   assert.equal(checks.length, 0); assert.equal(writes.length, 0);
   const input = { action: 'decide', receipt: preview.receipt, decision: 'confirm' };
   if (requiredProtocol === 2) {
    await assert.rejects(handler(request(input), dependencies), error => error.status === 409 && error.code === 'EMAIL_TRANSPORT_NOT_READY');
    assert.equal(writes.length, 0); assert.equal(scheduled.length, 0);
    supported = [1, 2];
   }
   const outcome = await handler(request(input), dependencies);
   assert.deepEqual(checks, Array.from({ length: requiredProtocol === 2 ? 2 : 1 }, () => ({ requiredProtocol })));
   assert.deepEqual(writes, [{ id, confirm: true, expectedHash: hash }]);
   assert.equal(kind === 'email-delegation' ? outcome.delegation.status : outcome.email.status, kind === 'email-delegation' ? 'active' : 'queued');
   await Promise.all(scheduled);
  });
 }
}

test('v2 rejection and revocation bypass transport readiness without dispatching', async () => {
 for (const status of ['proposed', 'active']) {
 const row = { id, author_id: id, status, policy_version: 'chat-email-v2', policy_hash: hash };
 const dependencies = { authorize: async () => auth, receiptKey: 'test-key', catalog: () => ({}),
  transport: () => assert.fail('revocation must not inspect or invoke transport'), schedule: () => assert.fail('revocation must not dispatch'),
  chatService: { getChatEmailDelegation: async () => row, hashChatEmailDelegation: () => hash,
   decideChatEmailDelegation: async (_auth, input) => { assert.equal(input.confirm, false); return { ...row, status: 'revoked' }; } },
 };
 const preview = await handleSecondBrain(request({ action: 'confirmation', kind: 'email-delegation', id }), dependencies);
 assert.equal(preview.mode, status === 'active' ? 'revoke' : 'confirm');
 const outcome = await handleSecondBrain(request({ action: 'decide', receipt: preview.receipt, decision: 'reject' }), dependencies);
 assert.equal(outcome.delegation.status, 'revoked');
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { aiErrorMessage } from './errors.js';
import { createCodexClient, driveCodexRun } from './codex-agent.js';
test('credit and billing errors are concise; temporary rate limits remain distinct', () => {
  for (const error of [
    {code:'insufficient_quota'}, {code:'credit_balance_exhausted'},
    {message:'Your organization has reached a usage or billing limit. Review your plan.'},
    {cause:{data:{error:{type:'insufficient_quota'}}}}
  ]) assert.equal(aiErrorMessage(error), 'Credito AI esaurito.');
  assert.equal(aiErrorMessage({code:'rate_limit_exceeded',message:'Too many requests'}), 'Too many requests');
  assert.equal(aiErrorMessage({message:'Permesso operativo MES richiesto.'}), 'Permesso operativo MES richiesto.');
});
test('provider HTTP quota failure is translated before reaching the UI', async () => {
  const client=createCodexClient({apiKey:'test-only',transport:async()=>({ok:false,status:429,json:async()=>({error:{code:'insufficient_quota',message:'Quota exceeded'}})})});
  await assert.rejects(client.create({}), error=>error.message==='Credito AI esaurito.' && error.providerStatus===429);
});
test('asynchronous provider failure persists and returns the same credit message', async () => {
  const run={id:'run',state:'pending',session_id:'session',turn_id:'turn',before_turn_id:'previous',scope_signature:''};
  // A run that already failed must return its translated persisted message.
  run.state='failed'; run.error='Credito AI esaurito.';
  await assert.rejects(driveCodexRun({store:{claim:async()=>({run,lease:'lease'}),release:async()=>{}},run,tools:{},client:{}}), /Credito AI esaurito/);
});


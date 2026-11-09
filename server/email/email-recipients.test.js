import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEmailRecipients} from './email-recipients.js';
test('v2 canonical mailbox grammar rejects parser syntax, Unicode, controls and malformed labels',()=>{
 for(const address of ['group:first@example.test','a(comment)@example.test','a@[127.0.0.1]','a\\b@example.test','a..b@example.test','.a@example.test','a.@example.test','a@-example.test','a@example-.test','a@ex_ample.test','é@example.test','a@exämple.test',`${'a'.repeat(65)}@example.test`,`a@${'a'.repeat(64)}.test`,'a@example.test\t']) assert.throws(()=>normalizeEmailRecipients({to:[address]}),/email/);
 assert.deepEqual(normalizeEmailRecipients({to:[' ONE+tag@Example.Test '],cc:[]}),{to:['one+tag@example.test'],cc:[],recipient:'one+tag@example.test',protocol:2});
 assert.deepEqual(normalizeEmailRecipients({recipient:'One@Example.Test'}),{recipient:'One@Example.Test',protocol:1});
});

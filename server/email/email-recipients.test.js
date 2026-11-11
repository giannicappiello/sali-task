import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEmailRecipients} from './email-recipients.js';
test('v2 canonical mailbox grammar rejects parser syntax, Unicode, controls and malformed labels',()=>{
 for(const address of ['group:first@example.test','a(comment)@example.test','a@[127.0.0.1]','a\\b@example.test','a..b@example.test','.a@example.test','a.@example.test','a@-example.test','a@example-.test','a@ex_ample.test','é@example.test','a@exämple.test',`${'a'.repeat(65)}@example.test`,`a@${'a'.repeat(64)}.test`,'a@example.test\t']) assert.throws(()=>normalizeEmailRecipients({to:[address]}),/email/);
 assert.deepEqual(normalizeEmailRecipients({to:[' ONE+tag@Example.Test '],cc:[]}),{to:['one+tag@example.test'],cc:[],recipient:'one+tag@example.test',protocol:2});
 assert.deepEqual(normalizeEmailRecipients({recipient:'One@Example.Test'}),{recipient:'One@Example.Test',protocol:1});
});

test('ordinary email recipient limit is 30 total, never 30 per role',()=>{
 const addresses=Array.from({length:31},(_,i)=>`user${i}@example.test`);
 for(const n of [10,11,30]) assert.equal(normalizeEmailRecipients({to:addresses.slice(0,n)}).to.length,n);
 const result=normalizeEmailRecipients({to:addresses.slice(0,15),cc:addresses.slice(15,30)});
 assert.equal(result.to.length+result.cc.length,30);
 for(const input of [{to:addresses},{to:addresses.slice(0,15),cc:addresses.slice(15)},{to:[],cc:addresses.slice(0,30)},{to:addresses.slice(0,29),cc:[addresses[0].toUpperCase()]}]) assert.throws(()=>normalizeEmailRecipients(input));
});

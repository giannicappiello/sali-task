import test from 'node:test';
import assert from 'node:assert/strict';
import {createSmtpClient, isPermanentSmtpError} from './smtp-client.js';
const env={SMTP_HOST:'smtp.example.test',SMTP_PORT:'465',SMTP_SECURE:'true',SMTP_USER:'unit-test',SMTP_PASSWORD:'unit-test',ORDER_EMAIL_FROM:'sender@example.test',ORDER_EMAIL_NAME:'Sender'};
function client(sendMail) {return createSmtpClient({getEnv:key=>env[key],createTransport:()=>({sendMail})});}
const payload={to:['first@example.test','second@example.test'],cc:['copy@example.test'],subject:'Private subject',text:'Private body'};
test('SMTP has all To and CC in both headers and envelope, without BCC',async()=>{
 const smtp=client(async message=>{
  assert.deepEqual(message.to,payload.to);assert.deepEqual(message.cc,payload.cc);
  assert.deepEqual(message.envelope,{from:env.ORDER_EMAIL_FROM,to:[...payload.to,...payload.cc]});
  assert.equal(Object.hasOwn(message,'bcc'),false);
  return {accepted:[...payload.to,...payload.cc],rejected:[],messageId:'id'};
 });
 assert.equal((await smtp.send(payload)).messageId,'id');
});
test('SMTP preserves legacy single To and reports authentication errors',async()=>{
 const smtp=client(async message=>{
  assert.equal(message.to,'Legacy@example.test');assert.equal(Object.hasOwn(message,'cc'),false);
  assert.deepEqual(message.envelope.to,['Legacy@example.test']);
  return {accepted:['Legacy@example.test'],rejected:[]};
 });
 await smtp.send({to:'Legacy@example.test',subject:'Legacy',text:'Body'});
 assert.equal(isPermanentSmtpError({code:'EAUTH'}),true);
});
test('SMTP rejects malformed, duplicate, excessive or BCC recipients before handoff',async()=>{
 const smtp=client(()=>assert.fail('invalid input must not be handed off'));
 for(const changed of [
  {to:[]},{to:'first@example.test,second@example.test'},
  {to:['first@example.test\r\nBcc:evil@example.test']},
  {cc:['copy@example.test\n']},{cc:['FIRST@example.test']},
  {to:Array.from({length:11},(_,i)=>`user${i}@example.test`),cc:[]},
  {bcc:['hidden@example.test']},{subject:'Injected\r\nBcc:evil@example.test'},
 ]) await assert.rejects(smtp.send({...payload,...changed}),error=>error.code==='EENVELOPE');
});
test('partial acceptance is uncertain, even with a permanent rejected recipient',async()=>{
 const smtp=client(async()=>({accepted:['first@example.test'],rejected:['second@example.test','copy@example.test'],response:'550 private'}));
 await assert.rejects(smtp.send(payload),error=>{
  assert.equal(error.code,'EPARTIALDELIVERY');assert.equal(isPermanentSmtpError(error),false);
  assert.equal(error.response,undefined);assert.equal(error.message.includes('private'),false);return true;
 });
});
test('missing acceptance is uncertain and complete rejection is definitive',async()=>{
 for(const [result,code,permanent] of [[{},'EDELIVERYUNCERTAIN',false],[{accepted:[],rejected:payload.to},'EENVELOPE',true],[{accepted:payload.to,rejected:[]},'EPARTIALDELIVERY',false]]){
  await assert.rejects(client(async()=>result).send(payload),error=>{
   assert.equal(error.code,code);assert.equal(isPermanentSmtpError(error),permanent);return true;
  });
 }
});

test('Nodemailer MIME and SMTP envelope retain To and CC with an offline stream transport',async()=>{
 const {default:nodemailer}=await import('nodemailer');
 const stream=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'windows'});
 let built;
 const smtp=client(async message=>{
  built=await stream.sendMail(message);
  return {...built,accepted:built.envelope.to,rejected:[]};
 });
 await smtp.send(payload);
 assert.deepEqual(built.envelope.to,[...payload.to,...payload.cc]);
 const headers=built.message.toString().split('\r\n\r\n')[0].replace(/\r\n[ \t]+/g,' ');
 assert.match(headers,/(?:^|\r\n)To: first@example\.test, second@example\.test(?:\r\n|$)/);
 assert.match(headers,/(?:^|\r\n)Cc: copy@example\.test(?:\r\n|$)/);
 assert.doesNotMatch(headers,/(?:^|\r\n)Bcc:/i);
});


test('legacy IDN accepted in Nodemailer canonical envelope completes an order without retry',async()=>{
 const {default:nodemailer}=await import('nodemailer');
 const {processNextOrderEmailJob}=await import('../orders/order-email-job.js');
 const stream=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'windows'});
 let sends=0;
 const smtp=client(async message=>{
  sends++;assert.equal(message.to,'lisa@bücher.example');
  const built=await stream.sendMail(message);
  assert.deepEqual(built.envelope.to,['lisa@xn--bcher-kva.example']);
  return {...built,accepted:built.envelope.to,rejected:[]};
 });
 const calls=[];
 const result=await processNextOrderEmailJob({supabase:{async rpc(name){
  calls.push(name);
  return {data:name==='claim_next_order_email'?[{id:1,ordine_id:'order-1',lock_token:'lock-1',destinatario:'lisa@bücher.example',oggetto:'Legacy IDN',corpo:'Body'}]:null};
 }},smtp,workerId:'test',logger:{log(){},error(){}},loadEmailData:async()=>({order:{id:'order-1'},attachments:[]})});
 assert.equal(result.status,'sent');assert.equal(sends,1);
 assert.deepEqual(calls,['claim_next_order_email','complete_order_email']);
});
test('legacy IDN compatibility also covers transports omitting the canonical envelope',async()=>{
 const result=await client(async()=>({accepted:['lisa@xn--bcher-kva.example'],rejected:[]}))
  .send({to:'lisa@bücher.example',subject:'Legacy IDN',text:'Body'});
 assert.deepEqual(result.accepted,['lisa@xn--bcher-kva.example']);
});
test('canonical envelope cannot hide partial delivery or a truncated To/CC list',async()=>{
 for(const result of [
  {envelope:{to:[...payload.to,...payload.cc]},accepted:payload.to,rejected:payload.cc},
  {envelope:{to:[...payload.to,...payload.cc]},accepted:payload.to,rejected:[]},
  {envelope:{to:payload.to},accepted:payload.to,rejected:[]},
 ]) await assert.rejects(client(async()=>result).send(payload),error=>{
  assert.equal(error.code,'EPARTIALDELIVERY');assert.equal(isPermanentSmtpError(error),false);return true;
 });
});

test('offline SMTP stream includes all 30 To+CC recipients in MIME and envelope',async()=>{
 const {default:nodemailer}=await import('nodemailer');
 const stream=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'windows'});
 const to=Array.from({length:15},(_,i)=>`to${i}@example.test`);
 const cc=Array.from({length:15},(_,i)=>`cc${i}@example.test`);
 let built;let sends=0;
 await client(async message=>{
  sends++;built=await stream.sendMail(message);
  return {...built,accepted:built.envelope.to,rejected:[]};
 }).send({...payload,to,cc,maxRecipients:30});
 assert.equal(sends,1);assert.deepEqual(built.envelope.to,[...to,...cc]);
 const headers=built.message.toString().split('\r\n\r\n')[0].replace(/\r\n[ \t]+/g,' ');
 const toHeader=headers.match(/(?:^|\r\n)To: (.*)/)[1];
 const ccHeader=headers.match(/(?:^|\r\n)Cc: (.*)/)[1];
 for(const address of to)assert.ok(toHeader.includes(address));
 for(const address of cc)assert.ok(ccHeader.includes(address));
 assert.doesNotMatch(headers,/(?:^|\r\n)Bcc:/i);
});

test('30-recipient transport opt-in still rejects 31 before handoff',async()=>{
 const smtp=client(()=>assert.fail('must not send'));
 await assert.rejects(smtp.send({...payload,to:Array.from({length:31},(_,i)=>`person${i}@example.test`),cc:[],maxRecipients:30}),error=>error.code==='EENVELOPE');
});

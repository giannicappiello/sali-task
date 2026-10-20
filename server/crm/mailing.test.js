import test from 'node:test';
import assert from 'node:assert/strict';
import { mailingByAccount } from '../../src/modules/crm/mailingModel.js';
import { fetchMailingReports } from './mailing-reports.js';
test('latest audience consent wins, audiences stay distinct and bounces are not received mailings', () => {
  const data = mailingByAccount([
    {account_id:'1',source:'mailchimp:a',status:'granted',captured_at:'2026-01-01'},
    {account_id:'1',source:'mailchimp:a',status:'withdrawn',captured_at:'2026-10-01'},
    {account_id:'1',source:'mailchimp:b',status:'granted',captured_at:'2026-10-01'},
  ], [
    {account_id:'1',connection_id:'c',campaign_id:'a',delivery_status:'sent'},
    {account_id:'1',connection_id:'c',campaign_id:'a',delivery_status:'sent'},
    {account_id:'1',connection_id:'c',campaign_id:'b',delivery_status:'hard_bounce'},
  ], [{account_id:'1',connection_id:'c'}], [{id:'c',import_state:{mailing_complete:true}}]);
  assert.equal(data.get('1').label,'Iscritto (1/2 audience)'); assert.equal(data.get('1').received,1);
  assert.equal(data.get('1').partial,false);
  assert.equal(mailingByAccount([],[],[{account_id:'1',connection_id:'c'}],[]).get('1').received,null);
});
test('reports read every recipient page and contain no private recipient payload', async () => {
  const reports=await fetchMailingReports({phase:'reports'},async path=>{assert.match(path,/^reports\?/);return {reports:[{id:'campaign',list_id:'list',campaign_title:'Newsletter',send_time:'2026-10-01'}],total_items:1};});
  assert.equal(reports.next.report.id,'campaign'); assert.equal(reports.next.reportQueue.length,0);
  const recipients=await fetchMailingReports({...reports.next,phase:'recipients'},async path=>{assert.match(path,/campaign\/sent-to/);return {sent_to:[{email_id:'hash',email_address:'private@example.com',list_id:'list',status:'sent'}],total_items:1};});
  assert.equal(recipients.next.completed,true);assert.equal(recipients.next.mailing_complete,true);
  assert.equal(recipients.rows[0].member_hash,'hash');assert.equal(JSON.stringify(recipients).includes('private@example.com'),false);
  await assert.rejects(fetchMailingReports({...reports.next,phase:'recipients'},async()=>({sent_to:'invalid',total_items:1})),/non validi/);
});

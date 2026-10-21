import test from 'node:test';
import assert from 'node:assert/strict';
import { mailingOverview } from '../../src/modules/crm/mailingOverviewModel.js';
const connection={id:'mc',import_state:{completed:true,mailing_complete:true}};
test('Mailchimp overview reads real deliveries, deduplicates contacts and keeps current consent separate from period',()=>{
 const identities=[
  {connection_id:'mc',account_id:'a',crm_accounts:{id:'a',nome:'Anna Verdi',email:'anna@example.test'}},
  {connection_id:'mc',account_id:'a',crm_accounts:{id:'a',nome:'Anna Verdi'}},
  {connection_id:'mc',account_id:'b',crm_accounts:{id:'b',nome:'Luca Rossi'}},
  {connection_id:'other',account_id:'c',crm_accounts:{id:'c',nome:'Excluded'}},
 ];
 const consents=[
  {account_id:'a',source:'mailchimp:list',status:'granted',captured_at:'2026-01-01'},
  {account_id:'a',source:'mailchimp:list',status:'withdrawn',captured_at:'2026-10-20'},
  {account_id:'b',source:'mailchimp:list',status:'granted',captured_at:'2026-10-20'},
 ];
 const deliveries=[
  {id:'1',connection_id:'mc',account_id:'a',campaign_id:'new',title:'News',sent_at:'2026-10-20T12:00:00Z',delivery_status:'sent'},
  {id:'2',connection_id:'mc',account_id:'b',campaign_id:'new',title:'News',sent_at:'2026-10-20T12:00:00Z',delivery_status:'hard'},
  {id:'3',connection_id:'mc',account_id:'a',campaign_id:'old',title:'Old',sent_at:'2026-01-01T12:00:00Z',delivery_status:'sent'},
  {id:'4',connection_id:'other',account_id:'a',campaign_id:'outside',sent_at:'2026-10-20',delivery_status:'sent'},
 ];
 const m=mailingOverview(identities,consents,deliveries,[connection],{from:'2026-10-01',to:'2026-10-21'});
 assert.equal(m.contacts.length,2);assert.equal(m.subscribers.length,1);assert.equal(m.subscribers[0].id,'b');
 assert.equal(m.sent,1);assert.equal(m.bounced,1);assert.equal(m.campaigns.length,1);assert.equal(m.totalCampaigns,2);
 assert.equal(m.contacts[0].received,2);assert.equal(m.contacts[0].receivedInPeriod,1);
 assert.equal(m.campaigns[0].recipients[0].email,'anna@example.test');
 assert.equal(m.campaigns[0].sent,1);assert.equal(m.campaigns[0].bounced,1);
});
test('period boundaries follow Italy local day, unknown dates are not fabricated',()=>{
 const row={connection_id:'mc',campaign_id:'x',delivery_status:'sent'};
 const m=mailingOverview([],[],[{...row,sent_at:'2026-10-20T22:30:00Z'},{...row,campaign_id:'invalid',sent_at:null}],[connection],{from:'2026-10-21',to:'2026-10-21'});
 assert.equal(m.sent,1);assert.equal(m.campaigns.length,1);
 assert.equal(m.contacts.length,0);
});

test('purchase column follows the contact across marketplaces, excludes failed orders and respects the selected period',()=>{
 const identities=[{connection_id:'mc',account_id:'a',crm_accounts:{id:'a',nome:'Anna Verdi'}}];
 const order={account_id:'a',currency:'EUR',ordered_at:'2026-10-10T12:00:00Z'};
 const orders=[
  {...order,id:'site',marketplace:'website',stato:'completed',net_revenue:100},
  {...order,id:'amazon',marketplace:'Amazon_IT',stato:'shipped',net_revenue:25},
  {...order,id:'waiting',marketplace:'website',stato:'processing',net_revenue:40},
  {...order,id:'cancelled',stato:'cancelled',net_revenue:999},
  {...order,id:'old',ordered_at:'2026-01-01',stato:'completed',net_revenue:200},
  {...order,id:'other',account_id:'b',stato:'completed',net_revenue:500},
 ];
 const deliveries=[{id:'d',connection_id:'mc',account_id:'a',campaign_id:'c',sent_at:'2026-10-10',delivery_status:'sent'}];
 const m=mailingOverview(identities,[],deliveries,[connection],{from:'2026-10-01',to:'2026-10-21'},orders);
 assert.equal(m.contacts[0].purchases.fulfilled_count,2);
 assert.equal(m.contacts[0].purchases.fulfilled_amounts.totals[0].amount,125);
 assert.equal(m.contacts[0].purchases.waiting_amounts.totals[0].amount,40);
 assert.deepEqual(m.campaigns[0].recipients[0].purchases,m.contacts[0].purchases);
});

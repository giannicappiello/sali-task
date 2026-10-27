import test from 'node:test';
import assert from 'node:assert/strict';
import { amazonTaxSnapshot,amazonCoxFinancials } from './amazon-tax.js';
import { amazonOrder,fetchCommercePage,initialImportState } from './commerce-import.js';

test('TAX imports only classification and line tax, excluding registrations and customer data',()=>{
  const source={orderId:'123-1234567-1234567',proceeds:{grandTotal:{amount:'13.20'},breakdowns:[{type:'TAX',subtotal:{amount:'0.99'}}]},
    tax:{taxRegistrations:[{legalName:'Private',taxRegistrationNumber:'Secret'}]},orderItems:[{orderItemId:'one',tax:{taxCollections:[{model:'MARKETPLACE_FACILITATOR',responsibleParty:'Amazon EU S.a.r.L.'}]},proceeds:{proceedsTotal:{amount:'13.20'},breakdowns:[{type:'TAX',subtotal:{amount:'0.99'}}]}}]};
  const snapshot=amazonTaxSnapshot(source);
  assert.equal(snapshot.model,'MARKETPLACE_FACILITATOR');assert.equal(snapshot.vat_code,'N41');assert.equal(snapshot.lines[0].tax_cents,99);
  assert.ok(!JSON.stringify(snapshot).match(/Private|Secret/));
  const imported=amazonOrder(source);
  assert.equal(imported.gross_revenue,13.2);assert.equal(imported.net_revenue,12.21);assert.deepEqual(imported.raw_summary.tax_collection,snapshot);
  const fiscal=amazonCoxFinancials(imported,imported.lines);
  assert.equal(fiscal.order.gross_revenue,12.21);assert.equal(fiscal.order.net_revenue,12.21);assert.equal(fiscal.lines[0].line_revenue,12.21);
  assert.equal(fiscal.proof.amazonCollectedTaxCents,99);assert.equal(imported.lines[0].line_revenue,13.2);
});

test('only confirmed MPF orders use N41; mixed regimes and unknown per-line allocations stop',()=>{
  const order={gross_revenue:13.2,net_revenue:12.21,raw_summary:{tax_collection:{model:'MARKETPLACE_FACILITATOR',vat_code:'N41',source:'user_confirmed'}}};
  assert.equal(amazonCoxFinancials(order,[{line_revenue:13.2}]).lines[0].line_revenue,12.21);
  assert.throws(()=>amazonCoxFinancials(order,[{line_revenue:6},{line_revenue:7.2}]),/ogni riga/);
  assert.throws(()=>amazonCoxFinancials({...order,raw_summary:{tax_collection:{model:'MIXED'}}},[]),/misto/);
  assert.equal(amazonTaxSnapshot({orderItems:[{tax:{taxCollections:[{model:'MARKETPLACE_FACILITATOR',responsibleParty:'Other'}]}}]}).model,'MIXED');
});

test('denied TAX dataset falls back without losing the fixed window or skipping a page',async()=>{
  const connection={provider_code:'amazon_sp_api',marketplace_ids:['IT'],configurazione:{region:'eu'}},now=new Date('2026-10-27T10:00:00Z');
  const state={...initialImportState(connection,now),priorityImported:true,token:'token',tokenIssuedAt:now.toISOString()};
  const queries=[];
  const page=await fetchCommercePage(connection,{},state,{now,fetcher:async url=>{
    if(url.includes('/auth/'))return {ok:true,data:{access_token:'private'}};
    const q=new URL(url).searchParams;queries.push(q);
    return q.get('includedData').includes('TAX')?{ok:false,status:403,data:{errors:[{code:'Unauthorized'}]}}:{ok:true,data:{orders:[]}};
  }});
  assert.equal(queries.length,2);assert.equal(queries[1].has('paginationToken'),false);
  assert.equal(queries[1].get('lastUpdatedAfter'),state.from);assert.equal(queries[1].get('lastUpdatedBefore'),state.to);assert.equal(page.next.taxAccess,'denied');
});

test('explicit fiscal classification survives an update without TAX data',async()=>{
  const connection={provider_code:'amazon_sp_api',marketplace_ids:['IT'],configurazione:{region:'eu'}},now=new Date('2026-10-27T10:00:00Z');
  const confirmed={model:'MARKETPLACE_FACILITATOR',vat_code:'N41',source:'user_confirmed'};
  const result=await fetchCommercePage(connection,{}, {...initialImportState(connection,now),priorityImported:true}, {now,
    loadTaxClassifications:async()=>new Map([['one',confirmed],['two',{...confirmed,source:'amazon_tax'}]]),
    fetcher:async url=>({ok:true,data:url.includes('/auth/')?{access_token:'private'}:{orders:['one','two'].map(orderId=>({orderId,salesChannel:{marketplaceId:'IT'}}))}})});
  assert.deepEqual(result.rows[0].raw_summary.tax_collection,confirmed);
  assert.equal(result.rows[1].raw_summary.tax_collection,undefined);
});

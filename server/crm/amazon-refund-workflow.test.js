import test from 'node:test';
import assert from 'node:assert/strict';
import {synchronizeCommerce} from './digital-connection-manager.js';

function setup(){
 const connection={id:'conn',provider_code:'amazon_sp_api',amazon_refunds_from:'2026-10-22',amazon_refund_state:{},amazon_cox_state:{active:true,phase:'emit'},import_state:{completed:true,counts:{orders:1}}};
 const calls=[];
 const db={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='crm_claim_commerce_import_service'?'run':null};},from(){let update;return {update(value){update=value;return this;},eq(){Object.assign(connection,update);return Promise.resolve({data:null});}};}};
 const deps={readConnection:async()=>connection,readSecrets:async()=>({}),coxSync:async()=>{connection.amazon_cox_state={};return {hasMore:false,emitted:0,failed:0};}};
 return {connection,db,deps,calls};
}

test('manual and daily commerce flow continue into refunds after sale COX completion',async()=>{
 const f=setup();let refunds=0;
 f.deps.refundSync=async()=>{refunds++;return {hasMore:false,emitted:1,updated:0,failed:0};};
 const sales=await synchronizeCommerce(f.db,null,f.connection,'scheduled',false,f.deps);
 assert.equal(sales.hasMore,true);assert.equal(f.connection.amazon_refund_state.active,true);
 const result=await synchronizeCommerce(f.db,null,f.connection,'scheduled',false,f.deps);
 assert.equal(refunds,1);assert.equal(result.resource,'amazon_refunds');assert.equal(result.hasMore,false);
});

test('refund provider failure retains its cursor without preventing the next ordinary order import',async()=>{
 const f=setup();f.connection.amazon_cox_state={};f.connection.amazon_refund_state={active:true,phase:'finance',token:'cursor'};
 let attempts=0;
 f.deps.refundSync=async()=>{attempts++;throw Error('Finances unavailable');};
 const result=await synchronizeCommerce(f.db,null,f.connection,'scheduled',false,f.deps);
 assert.equal(result.hasMore,false);assert.equal(f.connection.amazon_refund_state.active,false);
 assert.equal(f.connection.amazon_refund_state.token,'cursor');assert.match(f.connection.amazon_refund_state.lastError,/unavailable/);
 let imported=false;
 f.deps.fetchPage=async()=>{imported=true;return {kind:'orders',rows:[],next:{completed:false},hasMore:true};};
 const orders=await synchronizeCommerce(f.db,null,f.connection,'scheduled',false,f.deps);
 assert.equal(imported,true);assert.equal(attempts,1);assert.equal(orders.resource,'orders');
});

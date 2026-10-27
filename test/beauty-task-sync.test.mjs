import test from 'node:test';
import assert from 'node:assert/strict';
import {syncBeautyDayTasks} from '../supabase/functions/report-giornate-api/beautyTaskSync.js';

test('report saves project the persisted day and its consultant into one task, including reports and cancellations',async()=>{
 const calls=[];
 let day={id:'day',farmacia_id:'pharmacy',consultant_id:'beauty',data:'2026-11-10',stato:'pianificata'};
 const report={from(table){return{
  select(){return this;},eq(){return this;},
  async single(){return {data:day};},
  async maybeSingle(){return {data:table==='farmacie'?{nome:'Farmacia test'}:{agent_id:'agent'}};},
 };}};
 const primary={async rpc(name,args){calls.push({name,args});return {data:'one-task'};}};
 await syncBeautyDayTasks(primary,report,[{id:'day'}],'actor');
 assert.deepEqual(calls[0],{name:'workspace_sync_beauty_day',args:{p_day:{...day,customer_name:'Farmacia test',legacy_agent_id:'agent'},p_actor_id:'actor'}});
 day={...day,stato:'eseguita'};
 await syncBeautyDayTasks(primary,report,{id:'day'},'actor');assert.equal(calls[1].args.p_day.stato,'eseguita');
 await syncBeautyDayTasks(primary,report,day,'actor',true);assert.equal(calls[2].args.p_day.stato,'annullata');
 await assert.rejects(syncBeautyDayTasks({async rpc(){return {error:new Error('sync failed')};}},report,[day],'actor'),/sync failed/);
});

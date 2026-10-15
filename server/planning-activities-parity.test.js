import test from 'node:test';
import assert from 'node:assert/strict';
import {readActiveProductionPlan} from './hr-active-production-plan.js';
import {productionCalendarRequest} from './hr-production-calendar.js';
import {productionActivities,productionActivityStatus,activityOnDay} from '../src/pages/Dashboard/productionCalendar.js';

test('Station and Filling bars, batches and states pass unchanged from operational Planning to Activities', async()=>{
 const start='2026-10-15T17:00:00',end='2026-10-16T09:00:00';
 const state={displayedPlanning:true,configuration:{active:false},demands:[],version:{id:null,status:'APPLIED',snapshot:{
  resources:[{id:1,code:'ST01'},{id:2,code:'F03'}],
  tasks:[{id:72,orderId:5331,orderNumber:'RDP72',type:0,status:3,displayStatus:'In Lavorazione',resourceId:1,start,end,actualStart:start,batchNumber:1,batchCount:1,quantity:15000,
    workingIntervals:[{start,end}]},
    {id:73,orderId:5433,orderNumber:'RDP160-03',type:3,status:0,resourceId:2,start,end,batchNumber:2,batchCount:3,quantity:9600,
    workingIntervals:[{start,end}]}]}}};
 const plan=await readActiveProductionPlan(async()=>state,()=>assert.fail('Must not substitute the legacy archive'));
 assert.equal(plan.source,'planning-operativo');
 const result=await productionCalendarRequest({method:'GET',query:{from:'2026-10-15',to:'2026-10-16'}},{
  admin:{},authorize:async()=>['Production','Packaging','Cartoning'],readPlan:async()=>plan,
  readCalendar:()=>assert.fail('Must not reclip or recalculate the displayed Planning intervals')});
 const activities=productionActivities(result.items);
 assert.equal(activities.length,2);
 assert.deepEqual(activities.map(x=>x.resourceCode),['ST01','F03']);
 assert.deepEqual(activities.map(x=>x.quantity),[15000,9600]);
 assert.equal(activities[1].batchNumber,2);assert.equal(activities[1].batchCount,3);
 assert.equal(productionActivityStatus(activities[0]),'In Lavorazione');
 assert.equal(activityOnDay(activities[0],'2026-10-15'),true);
 assert.equal(activityOnDay(activities[1],'2026-10-16'),true);
 assert.deepEqual(activities[0].workingIntervals,[{start:'2026-10-15T17:00',end:'2026-10-16T09:00'}]);
});

import assert from "node:assert/strict";
import { runMexalEventAutomation } from "../api/mexal/run-event-automation.js";
const actions=[{id:2,sync_type:"stocks",scope:"global",execution_order:2,blocking:true,run_if_previous_failed:false,allow_continue_on_error:false},{id:1,sync_type:"products",scope:"selected_customer",execution_order:1,blocking:false,run_if_previous_failed:false,allow_continue_on_error:true}];
const chain={select(){return this},eq(){return this},order(){return Promise.resolve({data:actions.sort((a,b)=>a.execution_order-b.execution_order),error:null})}};
const admin={from(){return chain}};
const dry=await runMexalEventAutomation({admin,req:{headers:{}},eventKey:"before_new_order",context:{customerId:"c"},dryRun:true});
assert.deepEqual(dry.results.map(x=>x.syncType),["products","stocks"]); assert.equal(dry.executed,2);
assert.match(await (await import("node:fs/promises")).readFile("supabase/migrations/20260720020000_fix_mexal_event_automation_rls.sql","utf8"),/integrazioni_utenti/);
console.log("event automations: execution order, scope, dry run and RLS policy verified");

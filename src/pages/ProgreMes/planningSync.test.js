import assert from "node:assert/strict";
import test from "node:test";
import { reconcilePlanningView, planningSyncFailure } from "./planningSync.js";
test("alignment never replays plan generation and reports confirmed completion",async()=>{
 const calls=[];const result=await reconcilePlanningView("test-token",async(url,init)=>{
  calls.push({url,...JSON.parse(init.body)});return new Response(JSON.stringify({status:"COMPLETED"}));
 });
 assert.equal(result.status,"COMPLETED");assert.deepEqual(calls,[{url:"/api/workspace/planning",action:"planning_reconcile"}]);
});
test("the real server cause survives, including HTTP errors and inactive planning",async()=>{
 for(const [status,body,reason] of [[403,{error:"Permesso operativo MES richiesto."},"Permesso operativo"],[500,{error:"Mirror: vincolo articolo non presente"},"vincolo articolo"],[200,{status:"UNCHANGED",message:"Nuovo sistema non ancora attivo."},"non ancora attivo"]]){
  await assert.rejects(()=>reconcilePlanningView("token",async()=>new Response(JSON.stringify(body),{status})),error=>{
   assert.match(planningSyncFailure(error),new RegExp(reason));assert.match(planningSyncFailure(error),/Piano salvato in MES/);return true;
  });
 }
});
test("invalid responses and interrupted transport do not claim alignment succeeded",async()=>{
 await assert.rejects(()=>reconcilePlanningView("token",async()=>new Response("not-json",{status:502})),/HTTP 502/);
 await assert.rejects(()=>reconcilePlanningView("token",async()=>{throw Error("Connessione interrotta");}),/Connessione interrotta/);
});
test("deleted OCT blockage offers the existing recovery screen without cancelling any work", async()=>{
 const {planningSyncResolution}=await import("./planningSync.js");
 const action=planningSyncResolution(new Error("OCT_DELETED_IN_MEXAL: cancellazione MES da completare"));
 assert.deepEqual(action,{path:"/produzione/rdp-workbench?tab=blocked",label:"Apri OCT bloccati"});
 assert.equal(planningSyncResolution(new Error("Connessione interrotta")),null);
 assert.match(planningSyncFailure(new Error("OCT_DELETED_IN_MEXAL")),/OCT eliminato in Mexal/);
});

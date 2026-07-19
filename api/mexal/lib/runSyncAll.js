import { runRegisteredSync } from "./syncRegistry.js";
const PHASES=["clients","commercial_conditions","document_series","products","stocks"];
const EXCLUDED="Agenti esclusi: endpoint Mexal non configurato.";
export async function runSyncAll({db,automationRunId,authorization,baseUrl,source="manual",isStopped=async()=>false}){
 const results=[],completedPhases=[]; let processedActions=0,failedActions=0;
 const finish=(values={})=>({processedActions,failedActions,completedPhases,results,excluded:EXCLUDED,...values});
 for(let order=0;order<PHASES.length;order+=1){const type=PHASES[order];try{if(await isStopped())return finish({status:"stopped",stoppedAt:new Date().toISOString()});}catch(error){return finish({status:"failed",failedPhase:type,error:`Stop check ${type}: ${error.message}`});}
  const {error:currentError}=await db.from("mexal_automation_runs").update({current_action:type}).eq("id",automationRunId); if(currentError)return finish({status:"failed",failedPhase:type,error:`Current action ${type}: ${currentError.message}`});
  const {data:action,error:insertError}=await db.from("mexal_automation_action_runs").insert({automation_run_id:automationRunId,action_type:type,action_order:order,status:"running",started_at:new Date().toISOString(),idempotency_key:`${automationRunId}:${type}:${order}`}).select().single(); if(insertError||!action)return finish({status:"failed",failedPhase:type,error:`Create action ${type}: ${insertError?.message||"no row"}`}); processedActions+=1;
  try{const result=await runRegisteredSync({syncType:type,source,authorization,baseUrl});const {error}=await db.from("mexal_automation_action_runs").update({status:"completed",completed_at:new Date().toISOString(),result}).eq("id",action.id);if(error)throw new Error(`Complete action ${type}: ${error.message}`);completedPhases.push(type);results.push({type,status:"completed",result});}catch(error){failedActions+=1;const {error:updateError}=await db.from("mexal_automation_action_runs").update({status:"failed",completed_at:new Date().toISOString(),error_message:error.message}).eq("id",action.id);return finish({status:"failed",failedPhase:type,error:updateError?`${error.message}; record failure: ${updateError.message}`:error.message});}}
 return finish({status:"completed"});
}

import { readCostCalendar } from "./production-cost-calendar.js";
import { createHash } from "node:crypto";
import { createProgremesClient } from "./progremes-readonly-client.js";
import { stationHistorySummary, withAdditionalStationShifts } from "../src/features/production-costs/station-history.js";

export async function readStationHistory(admin,{settings,companyCalendar,request=()=>createProgremesClient({timeoutMs:30000}).request("production-cost-station-history")}={}) {
 try {
  companyCalendar??=await readCostCalendar(admin);
  settings={...settings,companyCalendar};
  const rows=await request();let source=rows?.[0];
  if(rows?.length!==1||!Array.isArray(source?.works)||
   !Number.isInteger(source.completedWorks)||!Number.isInteger(source.calendarShifts)||
   !Number.isInteger(source.mixingOperatorsCount))throw new Error("Contratto storico MES incompleto.");
  source=withAdditionalStationShifts(source,settings);
  const {generatedAt,asOfLocal,...stable}=source;
  const fingerprint=createHash("sha256").update(JSON.stringify(stable)).digest("hex");
  const saved=await admin.from("production_cost_station_history").upsert({fingerprint,source}, {onConflict:"fingerprint",ignoreDuplicates:true});
  if(saved.error)throw saved.error;
  const snapshot=await admin.from("production_cost_station_history").select("id,created_at").eq("fingerprint",fingerprint).single();
  if(snapshot.error)throw snapshot.error;
  return {...source,snapshotId:snapshot.data.id,snapshotCapturedAt:snapshot.data.created_at,generatedAt,asOfLocal};
 }catch(e){
  if(e.code==="INVALID_COST_CALENDAR")return {error:e.message,errorCode:e.code,productivity:null};
  return {error:e.upstreamStatus===404?"Aggiornare MES per abilitare la media storica STATION.":"Storico STATION MES non disponibile o non verificabile: costo non calcolabile.",productivity:null};
 }
}
export { stationHistorySummary };

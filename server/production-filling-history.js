import { readCostCalendar } from "./production-cost-calendar.js";
import { createHash } from "node:crypto";
import { createProgremesClient } from "./progremes-readonly-client.js";
import { fillingHistorySummary,withAdditionalFillingShifts } from "../src/features/production-costs/filling-history.js";
import { PRODUCTION_COST_HISTORY_FROM } from "./production-cost-history-period.js";

export async function readFillingHistory(admin,{settings,companyCalendar,historyFrom=settings?.historyFrom??PRODUCTION_COST_HISTORY_FROM,historyTo=settings?.historyTo??"",request=()=>createProgremesClient({timeoutMs: 300000}).request("production-cost-filling-history")}={}) {
 try {
  companyCalendar??=await readCostCalendar(admin);
  settings={...settings,companyCalendar,historyFrom,historyTo};
  const rows=await request();let source=rows?.[0];
  if(rows?.length!==1||!Array.isArray(source?.works)||
   !Number.isInteger(source.completedWorks)||!Number.isInteger(source.calendarShifts)||
   !Number.isInteger(source.packagingOperatorsCount)||!Object.hasOwn(source,"completedPieces")||!Object.hasOwn(source,"cartoningPieces"))throw new Error("Contratto storico FILLING incompleto.");
  source=withAdditionalFillingShifts(source,settings);
  // Reuse the existing server-only department evidence archive. Its legacy
  // table name is STATION, but JSON evidence is generic and immutable.
  // Namespace FILLING fingerprints so the two departments cannot collide.
  source={...source,economicDepartment:"Confezionamento",costMethod:"historical_pieces"};
  const {generatedAt,asOfLocal,...stable}=source;
  const fingerprint=createHash("sha256").update("FILLING:").update(JSON.stringify(stable)).digest("hex");
  const saved=await admin.from("production_cost_station_history").upsert({fingerprint,source},{onConflict:"fingerprint",ignoreDuplicates:true});
  if(saved.error)throw saved.error;
  const snapshot=await admin.from("production_cost_station_history").select("id,created_at").eq("fingerprint",fingerprint).single();
  if(snapshot.error)throw snapshot.error;
  return {...source,snapshotId:snapshot.data.id,snapshotCapturedAt:snapshot.data.created_at,generatedAt,asOfLocal};
 }catch(e){
  if(e.code==="INVALID_COST_CALENDAR")return {error:e.message,errorCode:e.code,productivity:null};
  return {error:e.upstreamStatus===404?"Aggiornare MES per abilitare la media storica FILLING.":"Storico FILLING MES non disponibile o non verificabile: costo non calcolabile.",productivity:null};
 }
}
export { fillingHistorySummary };

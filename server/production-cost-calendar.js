export async function readCostCalendar(admin) {
 const {data,error}=await admin.rpc("workspace_company_calendar_data");
 if(error || !data?.versions?.length || !Array.isArray(data.exceptions) || !Array.isArray(data.closures))
  throw Object.assign(new Error("Calendario aziendale HR non disponibile: riprovare prima di calcolare i costi."),{code:"INVALID_COST_CALENDAR",status:503});
 return data;
}

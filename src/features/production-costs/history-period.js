export const DEFAULT_HISTORY_FROM = "2026-10-01";
const validDate=value=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+"T00:00:00Z"))&&new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value;
export function validateHistoryPeriod(settings) {
 const from=settings?.historyFrom??DEFAULT_HISTORY_FROM,to=settings?.historyTo??"";
 if(!validDate(from))throw new Error("Data inizio calcolo medie non valida.");
 if(to!==""&&!validDate(to))throw new Error("Data fine calcolo medie non valida.");
 if(to&&to<from)throw new Error("La data fine calcolo medie deve essere uguale o successiva alla data inizio.");
}

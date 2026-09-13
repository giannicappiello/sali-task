export const money=v=>v===null||v===undefined?"Non disponibile":Number(v).toLocaleString("it-IT",{style:"currency",currency:"EUR"});
export const quantity=v=>v===null||v===undefined?"—":Number(v).toLocaleString("it-IT",{maximumFractionDigits:3});
export const date=v=>v?new Date(v).toLocaleDateString("it-IT"):"—";
export async function action(token,operation,extra={}) {
 const response=await fetch("/api/mexal/automation",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({action:"production_costs",operation,...extra})});
 const result=await response.json();
 if(!response.ok||result.success===false)throw new Error(result.error||result.message||"Operazione non riuscita.");
 return result;
}

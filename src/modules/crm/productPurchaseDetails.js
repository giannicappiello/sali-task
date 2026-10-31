
const numeric = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const documentKey = row => row.document_id || [row.category,row.document_number,row.document_date,row.customer_code||row.customer_name,row.document_status].join('|');
const customerKey = row => row.customer_code || row.customer_id || row.customer_name || 'unknown';
function addAmount(group,row) {
 const value=numeric(row.net_amount);
 if(value===null)group.unknownAmount=true;else group.amount+=value;
 group.quantity+=numeric(row.quantity)??0;
}
export function productDocuments(lines) {
 const groups=new Map();
 for(const row of lines) {
  const id=documentKey(row);
  if(!groups.has(id))groups.set(id,{...row,id,quantity:0,amount:0,unknownAmount:false});
  addAmount(groups.get(id),row);
 }
 return [...groups.values()].sort((a,b)=>String(b.document_date||'').localeCompare(String(a.document_date||''))||String(a.document_number||'').localeCompare(String(b.document_number||'')));
}
export function productCustomers(lines, fallback={}) {
 const groups=new Map();
 for(const original of lines) {
  const row={...original,customer_code:original.customer_code||fallback.code,customer_name:original.customer_name||fallback.name};
  const id=customerKey(row);
  if(!groups.has(id))groups.set(id,{id,customer_code:row.customer_code,customer_name:row.customer_name||'Cliente non disponibile',quantity:0,amount:0,unknownAmount:false,lines:[]});
  const group=groups.get(id);group.lines.push(row);addAmount(group,row);
 }
 return [...groups.values()].map(group=>({...group,documents:productDocuments(group.lines)})).sort((a,b)=>a.customer_name.localeCompare(b.customer_name,'it'));
}

export function productAgents(lines,fallback={}) {
 const groups=new Map();
 for(const row of lines) {
  const code=row.agent_code||fallback.agentCode||'';
  const name=row.agent_name||fallback.agentName||'Senza agente';
  const id=code||(name==='Senza agente'?'':name);
  if(!groups.has(id))groups.set(id,{id,agent_code:code,agent_name:name,quantity:0,amount:0,unknownAmount:false,lines:[]});
  const group=groups.get(id);group.lines.push(row);addAmount(group,row);
 }
 return [...groups.values()].map(group=>({...group,customers:productCustomers(group.lines,fallback).length}));
}

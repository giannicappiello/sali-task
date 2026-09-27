export function costRows(costs,projects,tasks){
 const ps=new Map(projects.map(p=>[p.id,p])),ts=new Map(tasks.map(t=>[t.id,t]));
 return costs.map(c=>{const task=ts.get(c.phase_id),project=ps.get(c.project_id||task?.progetto_id);return {...c,task,project,kind:c.phase_id?'task':'project',target:task?.titolo||project?.titolo||'Non disponibile'};});
}
export function costSummary(rows){
 const cents=r=>Math.round(Number(r.amount)*100);
 const total=kind=>rows.filter(r=>!kind||r.kind===kind).reduce((s,r)=>s+cents(r),0)/100;
 return {total:total(),tasks:total('task'),projects:total('project'),count:rows.length};
}
export function projectCostRows(rows){
 const map=new Map();
 for(const r of rows){if(!r.project)continue;const p=map.get(r.project.id)||{...r.project,direct:0,tasks:0,total:0};const amount=Math.round(Number(r.amount)*100);p[r.kind==='task'?'tasks':'direct']+=amount;p.total+=amount;map.set(p.id,p);}
 return [...map.values()].map(p=>({...p,direct:p.direct/100,tasks:p.tasks/100,total:p.total/100}));
}

export function costCustomerIndex(customers, accounts) {
 const index = new Map(customers.map(c => [`mexal:${c.codice_cliente}`, {key:`mexal:${c.codice_cliente}`,name:c.ragione_sociale || c.codice_cliente}]));
 for (const a of accounts) {
  const key = a.codice_cliente_mexal ? `mexal:${a.codice_cliente_mexal}` : `crm:${a.id}`;
  index.set(`crm:${a.id}`, index.get(key) || {key,name:a.nome || 'Cliente senza nome'});
 }
 return index;
}
export function resolveCostCustomer(item, project, index) {
 const key = project?.crm_customer_key || item?.crm_customer_key || '';
 return index.get(key) || {key:key || 'unassigned',name:key ? 'Cliente non disponibile' : 'Cliente non assegnato'};
}
const closed = new Set(['evaso','evasa','completato','completata','chiuso','chiusa','annullato','annullata','archiviato','archiviata']);
export const costItemOpen = item => !item.completato_at && !closed.has(String(item.stato || '').trim().toLowerCase());
const byCreation = (a,b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || a.titolo.localeCompare(b.titolo,'it') || a.id.localeCompare(b.id);
export function costClientTree(projects,tasks,rows,customers,{search='',projectId='',kind=''}={}) {
 const groups = new Map(), query=search.trim().toLocaleLowerCase('it-IT');
 const matches = (...values) => values.join(' ').toLocaleLowerCase('it-IT').includes(query);
 const forTarget = (id,type) => rows.filter(r => type==='project'?r.project_id===id:r.phase_id===id);
 const sum = costs => costs.reduce((n,r)=>n+Math.round(Number(r.amount)*100),0)/100;
 const group = customer => {if(!groups.has(customer.key))groups.set(customer.key,{...customer,projects:[],tasks:[]});return groups.get(customer.key);};
 for(const p of projects.filter(p=>(costItemOpen(p)||tasks.some(t=>t.progetto_id===p.id&&costItemOpen(t)))&&(!projectId||p.id===projectId)).sort(byCreation)) {
  const customer=resolveCostCustomer(p,null,customers), own=forTarget(p.id,'project');
  const parentMatch=matches(customer.name,p.titolo,customer.key);
  const children=tasks.filter(t=>t.progetto_id===p.id).sort(byCreation).filter(t=>parentMatch||matches(t.titolo,...forTarget(t.id,'task').map(r=>`${r.description} ${r.operator_name||''}`))).map(t=>({...t,total:sum(forTarget(t.id,'task'))}));
  if(!parentMatch&&!children.length&&!matches(...own.map(r=>`${r.description} ${r.operator_name||''}`)))continue;
  const direct=sum(own),taskTotal=children.reduce((n,t)=>n+Math.round(t.total*100),0)/100;
  group(customer).projects.push({...p,direct,tasks:kind==='project'?[]:children,total:direct+taskTotal});
 }
 if(!projectId&&kind!=='project')for(const t of tasks.filter(t=>(!t.progetto_id||!projects.some(p=>p.id===t.progetto_id))&&costItemOpen(t)).sort(byCreation)){
  const customer=resolveCostCustomer(t,null,customers), own=forTarget(t.id,'task');
  if(matches(customer.name,customer.key,t.titolo,...own.map(r=>`${r.description} ${r.operator_name||''}`)))group(customer).tasks.push({...t,total:sum(own)});
 }
 return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'it')).map(g=>({...g,total:[...g.projects,...g.tasks].reduce((n,r)=>n+Math.round(r.total*100),0)/100}));
}

export function costEntryPayload(entry,target) {
 if(!target.target)throw Error('Seleziona un progetto o una attività.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(entry.cost_date||''))throw Error('Indica una data valida.');
 const labor=entry.cost_type==='labor';
 if((!labor&&(entry.amount===''||entry.amount==null))||(labor&&(entry.hourly_rate===''||entry.hourly_rate==null)))throw Error('Indica un importo valido.');
 const hours=Number(entry.hours),rate=Number(entry.hourly_rate),amount=labor?Math.round(hours*rate*100)/100:Number(entry.amount);
 if(!Number.isFinite(amount)||amount<0||amount>999999999999.99)throw Error('Indica un importo valido.');
 if(labor&&(!Number.isFinite(hours)||hours<=0||!Number.isFinite(rate)||rate<0||!entry.operator_name?.trim()))throw Error('Completa ore, tariffa e operatore.');
 return {project_id:target.kind==='project'?target.target:null,phase_id:target.kind==='task'?target.target:null,cost_type:entry.cost_type,cost_date:entry.cost_date,
  description:entry.description?.trim()||(labor?'Lavoro':'Materiali'),amount,hours:labor?hours:null,hourly_rate:labor?rate:null,operator_name:labor?entry.operator_name.trim():null};
}

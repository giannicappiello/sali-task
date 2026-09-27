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

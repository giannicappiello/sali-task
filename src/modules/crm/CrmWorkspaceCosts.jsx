import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '../../lib/supabaseClient';
import {useAuth} from '../../contexts/AuthContext';
import InfoTooltip from '../../components/InfoTooltip';
import {CrmPageHeader,CrmSectionNav} from './CrmWorkspaceUI';
import CrmPeriodFilter,{useCrmPeriod} from './CrmPeriodFilter';
import {crmNavigation} from './crmNavigation';
import {formatMoney,formatDate} from './crmConfig';
import {loadAllQueryRows} from './crmDataset';
import {costRows,costSummary,costCustomerIndex,resolveCostCustomer,costClientTree} from './workspaceCostModel';
import WorkspaceCostDialog from './WorkspaceCostDialog';
import './workspace-costs.css';

export default function CrmWorkspaceCosts(){
 const period=useCrmPeriod(),{canUseModule,isAdmin,user}=useAuth(),canWrite=canUseModule('crm_conto_terzi','scrittura');
 const [data,setData]=useState({costs:[],projects:[],tasks:[],customers:[],accounts:[]});
 const [error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [form,setForm]=useState(null),[search,setSearch]=useState(''),[kind,setKind]=useState(''),[project,setProject]=useState(''),[deleting,setDeleting]=useState(null);
 const sequence=useRef(0);
 const load=useCallback(async()=>{
  const request=++sequence.current;setLoading(true);
  try{
   const queries=[['crm_workspace_costs','*'],['v4_progetti','id,titolo,stato,crm_customer_key,created_at'],['v4_fasi_progetto','id,titolo,stato,progetto_id,crm_customer_key,created_at,completato_at'],['crm_classified_customers','codice_cliente,ragione_sociale'],['crm_accounts','id,nome,codice_cliente_mexal']];
   const results=await Promise.all(queries.map(([table,columns],i)=>loadAllQueryRows((a,b)=>{
    let q=supabase.from(table).select(columns).order(i===3?'codice_cliente':'id').range(a,b);
    if(i===1||i===2)q=q.eq('crm_tipo','conto_terzi');if(i===3)q=q.eq('area_crm','conto_terzi');if(i===4)q=q.eq('tipo','conto_terzi');return q;
   })));
   const failure=results.find(r=>r.error);if(failure)throw failure.error;
   if(request===sequence.current){setData(Object.fromEntries(['costs','projects','tasks','customers','accounts'].map((key,i)=>[key,results[i].data])));setError('');}
  }catch(e){if(request===sequence.current)setError(e.message);}finally{if(request===sequence.current)setLoading(false);}
 },[]);
 useEffect(()=>{void load();return()=>{sequence.current++;};},[load]);
 const customers=useMemo(()=>costCustomerIndex(data.customers,data.accounts),[data.customers,data.accounts]);
 const allRows=useMemo(()=>costRows(data.costs,data.projects,data.tasks).map(r=>({...r,customer:resolveCostCustomer(r.task||r.project,r.project,customers)})),[data,customers]);
 const rows=allRows.filter(r=>r.cost_date>=period.from&&r.cost_date<=period.to&&(!kind||r.kind===kind)&&(!project||r.project?.id===project)&&`${r.customer.name} ${r.customer.key} ${r.description} ${r.operator_name||''} ${r.target} ${r.project?.titolo||''}`.toLocaleLowerCase('it-IT').includes(search.trim().toLocaleLowerCase('it-IT')));
 const totals=costSummary(rows),tree=costClientTree(data.projects,data.tasks,rows,customers,{search,projectId:project,kind});
 const operator=[user?.nome,user?.cognome].filter(Boolean).join(' ');
 const start=(kind='task',target='')=>{setError('');setForm({kind,target});};
 async function save(payload,id){
  if(!canWrite)throw Error('Non hai il permesso di registrare costi.');
  const result=id?await supabase.from('crm_workspace_costs').update(payload[0]).eq('id',id).select('id').single():await supabase.from('crm_workspace_costs').insert(payload).select('id');
  if(result.error)throw result.error;await load();
 }
 async function remove(){if(busy||!canWrite)return;setBusy(true);try{const r=await supabase.from('crm_workspace_costs').delete().eq('id',deleting).select('id').single();if(r.error)throw r.error;setDeleting(null);await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
 const addButton=(kind,id)=>canWrite&&<button type="button" disabled={busy} onClick={()=>start(kind,id)}>Aggiungi costo</button>;
 const taskRow=t=><div className="crm-cost-tree-row crm-cost-task-row" key={t.id}><span><strong>{t.titolo}</strong><small>Attività / fase · {t.stato}</small></span><strong>{formatMoney(t.total)}</strong>{addButton('task',t.id)}</div>;
 return <div className="crm-page crm-cost-page">
  <CrmPageHeader eyebrow="CRM PRIVATE" title="Rendicontazione" description="Consuntivi di task, fasi e progetti Workspace."><CrmSectionNav items={crmNavigation('conto_terzi')} period={period}/></CrmPageHeader>
  {error&&<div role="alert" className="crm-message error">{error}</div>}
  <section className="panel crm-cost-filters"><CrmPeriodFilter period={period} compact/>
   <label>Ricerca totale<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cliente, attività, progetto, operatore o costo"/></label>
   <label>Progetto<select value={project} onChange={e=>setProject(e.target.value)}><option value="">Tutti</option>{data.projects.map(p=><option key={p.id} value={p.id}>{p.titolo}</option>)}</select></label>
   <label>Attribuzione<select value={kind} onChange={e=>setKind(e.target.value)}><option value="">Tutte</option><option value="task">Task / fase</option><option value="project">Diretta al progetto</option></select></label>
   <button onClick={load} disabled={loading||busy}>Aggiorna</button><button className="primary-action crm-primary" disabled={!canWrite||busy||loading} onClick={()=>start()}>Aggiungi costo</button>
  </section>
  <div className="crm-cost-cards">{[['Consuntivo totale',totals.total,'Somma dei costi registrati nel periodo e nei filtri selezionati.',''],['Costi task / fasi',totals.tasks,'Costi attribuiti alle attività e alle fasi.','task'],['Costi diretti progetti',totals.projects,'Costi attribuiti direttamente ai progetti, senza duplicare quelli delle attività.','project']].map(([title,value,info,filter])=><section className="panel" key={title}><h3>{title} <InfoTooltip text={info}/></h3><button className="crm-cost-value" onClick={()=>setKind(filter)}>{loading?'…':formatMoney(value)}</button></section>)}</div>
  {form&&<WorkspaceCostDialog initial={form} operator={operator} isAdmin={isAdmin()} projects={data.projects.map(p=>({...p,customerName:resolveCostCustomer(p,null,customers).name}))} tasks={data.tasks.map(t=>({...t,customerName:resolveCostCustomer(t,data.projects.find(p=>p.id===t.progetto_id),customers).name}))} onSave={save} onClose={()=>setForm(null)}/>}
  <section className="panel crm-cost-tree"><h3>Consuntivi per progetto <InfoTooltip text="Clienti con progetti o attività in corso, anche senza costi. Prima i progetti per data di inserimento, dal meno recente, poi le attività singole. Gli importi rispettano il periodo e i filtri selezionati."/></h3>
   {tree.map(client=><details className="crm-cost-client" key={client.key}><summary><strong>{client.name}</strong><span>{client.projects.length} progetti · {client.tasks.length} attività singole</span><strong>{formatMoney(client.total)}</strong></summary>
    <div className="crm-cost-client-content">{client.projects.map(p=><div className="crm-cost-project" key={p.id}><details><summary><span><strong>{p.titolo}</strong><small>Progetto · inserito il {formatDate(p.created_at)} · {p.stato}</small></span><strong>{formatMoney(p.total)}</strong></summary><div className="crm-cost-project-tasks">{p.tasks.map(taskRow)}{!p.tasks.length&&<p>Nessuna attività per i filtri selezionati.</p>}</div></details>{addButton('project',p.id)}</div>)}{client.tasks.map(taskRow)}</div>
   </details>)}
   {loading?<p role="status">Caricamento…</p>:!tree.length&&<p>Nessun cliente con progetti o attività in corso per questi filtri.</p>}
  </section>
  <section className="panel"><h3>Costi registrati · {totals.count}</h3><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Data</th><th>Cliente</th><th>Attività / progetto</th><th>Voce</th><th>Descrizione / operatore</th><th>Consuntivo</th>{canWrite&&<th>Azioni</th>}</tr></thead><tbody>{rows.map(r=><tr key={r.id}>
   <td data-label="Data">{formatDate(r.cost_date)}</td><td data-label="Cliente">{r.customer.name}</td><td data-label="Attività / progetto">{r.target}<small>{r.kind==='task'?r.project?.titolo||'Attività singola':'Costo diretto progetto'}</small></td>
   <td data-label="Voce">{r.cost_type==='labor'?'Lavoro':r.cost_type==='materials'?'Materiali':'Costo precedente'}{r.cost_type==='labor'&&<small>{r.hours} ore × {formatMoney(r.hourly_rate)}</small>}</td>
   <td data-label="Descrizione / operatore">{r.description}{r.operator_name&&<small>{r.operator_name}</small>}</td><td data-label="Consuntivo">{formatMoney(r.amount)}</td>
   {canWrite&&<td data-label="Azioni"><button disabled={busy} onClick={()=>setForm({...r,target:r.phase_id||r.project_id})}>Modifica</button>{deleting===r.id?<><button disabled={busy} onClick={remove}>Conferma eliminazione</button><button onClick={()=>setDeleting(null)}>Annulla</button></>:<button disabled={busy} onClick={()=>setDeleting(r.id)}>Elimina</button>}</td>}
  </tr>)}</tbody></table>{loading?<p className="crm-empty">Caricamento…</p>:!rows.length&&<p className="crm-empty">Nessun costo registrato per questi filtri.</p>}</div></section>
 </div>;
}

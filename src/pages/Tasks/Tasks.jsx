import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Search, CalendarDays, AlertCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import TaskModal from "./TaskModal";

function Tasks() {
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState({ open: false, mode: "create", task: null });

  const activeFilter = searchParams.get("filter") || "tutte";
  const activeDate = searchParams.get("date") || "";
  const activeProject = searchParams.get("project") || "";
  const activeProduct = searchParams.get("product") || "";

  useEffect(() => { loadTasks(); }, []);

  async function loadTasks() {
    setLoading(true);
    const { data, error } = await supabase
      .from("tasks")
      .select(`
        id,titolo,descrizione,categoria_id,stato_id,prodotto_id,progetto_id,
        assegnato_a_id,richiedente_id,creato_da_id,modificato_da_id,deadline,
        data_apertura,data_completamento,created_at,updated_at,
        categorie_task(nome,colore),stati_task(nome,colore,chiusa),
        prodotti(id,nome,codice),progetti(id,nome),
        richiedente:utenti!tasks_richiedente_id_fkey(nome),
        assegnato:utenti!tasks_assegnato_a_id_fkey(nome),
        creato_da:utenti!tasks_creato_da_id_fkey(nome),
        modificato_da:utenti!tasks_modificato_da_id_fkey(nome)
      `)
      .order("deadline", { ascending: true, nullsFirst: false });
    if (error) console.error("Errore caricamento task:", error);
    setTasks(data || []);
    setLoading(false);
  }

  function openCreateModal(){ setModal({open:true,mode:"create",task:null}); }
  function openEditModal(task){ setModal({open:true,mode:"edit",task}); }
  function closeModal(){ setModal({open:false,mode:"create",task:null}); }

  function getToday(){ const d = new Date(); d.setHours(0,0,0,0); return d; }
  function getDateOnly(date){ if(!date) return null; const d = new Date(`${date}T00:00:00`); d.setHours(0,0,0,0); return d; }
  function isClosed(task){ return Boolean(task.stati_task?.chiusa); }
  function isOpen(task){ return !isClosed(task); }
  function isToday(task){ return task.deadline && getDateOnly(task.deadline)?.getTime() === getToday().getTime(); }
  function isOverdue(task){ return task.deadline && !isClosed(task) && getDateOnly(task.deadline) < getToday(); }
  function isUrgent(task){ if(!task.deadline || isClosed(task)) return false; const diff = Math.ceil((getDateOnly(task.deadline)-getToday())/(1000*60*60*24)); return diff>=0 && diff<=3; }
  function isMine(task){ return task.assegnato_a_id === profile?.id; }
  function hasNoDeadline(task){ return !task.deadline; }

  function formatDate(date){ if(!date) return "Senza deadline"; return new Date(`${date}T00:00:00`).toLocaleDateString("it-IT",{day:"2-digit",month:"short",year:"numeric"}); }
  function formatDateTime(date){ if(!date) return "-"; return new Date(date).toLocaleString("it-IT",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}); }

  function matchesSearch(task){
    const text = `${task.titolo||""} ${task.descrizione||""} ${task.prodotti?.nome||""} ${task.prodotti?.codice||""} ${task.progetti?.nome||""} ${task.assegnato?.nome||""} ${task.categorie_task?.nome||""} ${task.stati_task?.nome||""}`.toLowerCase();
    return text.includes(search.toLowerCase());
  }

  function matchesFilter(task){
    if(activeDate) return task.deadline === activeDate;
    if(activeProject) return task.progetto_id === activeProject;
    if(activeProduct) return task.prodotto_id === activeProduct;
    if(activeFilter === "aperte") return isOpen(task);
    if(activeFilter === "oggi") return isToday(task) && isOpen(task);
    if(activeFilter === "scadute") return isOverdue(task);
    if(activeFilter === "completate") return isClosed(task);
    if(activeFilter === "senza_deadline") return hasNoDeadline(task);
    if(activeFilter === "mie") return isMine(task) && isOpen(task);
    if(activeFilter === "urgenti") return isMine(task) && isUrgent(task);
    if(activeFilter === "mie_scadute") return isMine(task) && isOverdue(task);
    return true;
  }

  const counters = useMemo(() => ({
    tutte: tasks.length,
    aperte: tasks.filter(isOpen).length,
    oggi: tasks.filter(t => isToday(t) && isOpen(t)).length,
    scadute: tasks.filter(isOverdue).length,
    completate: tasks.filter(isClosed).length,
    senza_deadline: tasks.filter(hasNoDeadline).length,
    mie: tasks.filter(t => isMine(t) && isOpen(t)).length,
    urgenti: tasks.filter(t => isMine(t) && isUrgent(t)).length,
  }), [tasks, profile?.id]);

  const filters = [
    {id:"tutte",label:"Tutte",count:counters.tutte},
    {id:"aperte",label:"Aperte",count:counters.aperte},
    {id:"oggi",label:"Oggi",count:counters.oggi},
    {id:"scadute",label:"Scadute",count:counters.scadute},
    {id:"completate",label:"Completate",count:counters.completate},
    {id:"mie",label:"Le mie",count:counters.mie},
    {id:"urgenti",label:"Urgenti",count:counters.urgenti},
    {id:"senza_deadline",label:"Senza deadline",count:counters.senza_deadline},
  ];

  const filteredTasks = tasks.filter(t => matchesSearch(t) && matchesFilter(t));
  function setFilter(filter){ filter === "tutte" ? setSearchParams({}) : setSearchParams({filter}); }
  function resetSpecialFilter(){ setSearchParams({}); }

  function subtitle(){
    if(activeDate) return `Task con deadline ${new Date(`${activeDate}T00:00:00`).toLocaleDateString("it-IT")}`;
    if(activeProject) return `Storico task collegate al progetto: ${tasks.find(t=>t.progetto_id===activeProject)?.progetti?.nome || activeProject}`;
    if(activeProduct) return `Storico task collegate al prodotto: ${tasks.find(t=>t.prodotto_id===activeProduct)?.prodotti?.nome || activeProduct}`;
    return `Filtro attivo: ${(filters.find(f=>f.id===activeFilter)||filters[0]).label}`;
  }

  return (
    <div className="tasks-page">
      <div className="page-title-row">
        <div><h1>Task</h1><p>{subtitle()}</p></div>
        <button className="primary-action" onClick={openCreateModal}><Plus size={18}/>Nuova task</button>
      </div>
      <div className="task-toolbar">
        <div className="task-search"><Search size={18}/><input placeholder="Cerca task, prodotto, progetto o utente..." value={search} onChange={(e)=>setSearch(e.target.value)}/></div>
        {(activeDate || activeProject || activeProduct) && <button className="filter-chip active" onClick={resetSpecialFilter}>Filtro collegato<span className="filter-count">×</span></button>}
        {!activeDate && !activeProject && !activeProduct && filters.map(f => <button key={f.id} className={`filter-chip ${activeFilter===f.id?"active":""}`} onClick={()=>setFilter(f.id)}>{f.label}<span className="filter-count">{f.count}</span></button>)}
      </div>
      <div className="panel tasks-panel">
        {loading ? <p className="table-message">Caricamento task...</p> : filteredTasks.length===0 ? <p className="table-message">Nessuna task trovata per questo filtro.</p> : (
          <div className="tasks-table authors-table">
            <div className="tasks-table-head"><span>Task</span><span>Categoria</span><span>Stato</span><span>Progetto</span><span>Assegnato a</span><span>Creata da</span><span>Modificata da</span><span>Creato il</span><span>Modificato il</span><span>Deadline</span></div>
            {filteredTasks.map(task => {
              const overdue = isOverdue(task); const today = isToday(task);
              return <button type="button" className={`tasks-table-row ${overdue?"overdue":""}`} key={task.id} onClick={()=>openEditModal(task)}>
                <div className="task-main-cell"><strong>{task.titolo}</strong><small>{task.descrizione || "Nessuna descrizione"}</small><small className="task-product-line">{task.prodotti?.nome || "Nessun prodotto"}</small></div>
                <span className="status-badge" style={{backgroundColor:`${task.categorie_task?.colore || "#64748b"}20`,color:task.categorie_task?.colore || "#64748b"}}>{task.categorie_task?.nome || "-"}</span>
                <span className="status-badge" style={{backgroundColor:`${task.stati_task?.colore || "#64748b"}20`,color:task.stati_task?.colore || "#64748b"}}>{task.stati_task?.nome || "-"}</span>
                <span>{task.progetti?.nome || "-"}</span><span>{task.assegnato?.nome || "-"}</span><span>{task.creato_da?.nome || "-"}</span><span>{task.modificato_da?.nome || "-"}</span><span>{formatDateTime(task.created_at)}</span><span>{formatDateTime(task.updated_at)}</span>
                <span className={`deadline-cell ${overdue?"danger":""} ${today?"today":""}`}>{overdue ? <AlertCircle size={16}/> : <CalendarDays size={16}/>} {formatDate(task.deadline)}</span>
              </button>
            })}
          </div>
        )}
      </div>
      <TaskModal key={`${modal.mode}-${modal.task?.id || "new"}-${modal.open ? "open" : "closed"}`} open={modal.open} mode={modal.mode} task={modal.task} onClose={closeModal} onSaved={loadTasks}/>
    </div>
  );
}
export default Tasks;

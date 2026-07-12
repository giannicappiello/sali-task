import { useEffect, useState } from "react";
import { X, History, MessageCircle, Paperclip, CheckSquare, Send, Upload, Trash2, Download, Plus } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

function TaskModal({ open, mode = "create", task = null, onClose, onSaved }) {
  const { profile } = useAuth();

  async function getCurrentUtenteId() {
    if (profile?.id) {
      const byId = await supabase.from("utenti").select("id").eq("id", profile.id).maybeSingle();
      if (byId.data?.id) return byId.data.id;
    }

    if (profile?.auth_user_id) {
      const byProfileAuth = await supabase.from("utenti").select("id").eq("auth_user_id", profile.auth_user_id).maybeSingle();
      if (byProfileAuth.data?.id) return byProfileAuth.data.id;
    }

    const { data: authData } = await supabase.auth.getUser();
    const authUserId = authData?.user?.id;
    if (!authUserId) return null;

    const byAuth = await supabase.from("utenti").select("id").eq("auth_user_id", authUserId).maybeSingle();
    return byAuth.data?.id || null;
  }

  const isEditing = mode === "edit" && task?.id;
  const [activeTab, setActiveTab] = useState("dettagli");
  const [form, setForm] = useState({ titolo:"", descrizione:"", categoria_id:"", stato_id:"", progetto_id:"", prodotto_id:"", assegnato_a_id:"", deadline:"", bloccante_id:"" });
  const [opts, setOpts] = useState({ categorie:[], stati:[], progetti:[], prodotti:[], utenti:[], tasks:[] });
  const [attivita, setAttivita] = useState([]);
  const [commenti, setCommenti] = useState([]);
  const [allegati, setAllegati] = useState([]);
  const [checklist, setChecklist] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [newChecklist, setNewChecklist] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    init();
  }, [open, task?.id]);

  async function init() {
    setActiveTab("dettagli");
    const [categorie, stati, progetti, prodotti, utenti, tasksRes] = await Promise.all([
      supabase.from("categorie_task").select("*").eq("attiva", true).order("ordine"),
      supabase.from("stati_task").select("*").eq("attiva", true).order("ordine"),
      supabase.from("progetti").select("*").order("nome"),
      supabase.from("prodotti").select("*").order("nome"),
      supabase.from("utenti").select("*").eq("attivo", true).order("nome"),
      supabase.from("tasks").select("id,titolo,stato_id,deadline").order("deadline", { ascending: true, nullsFirst: false }).limit(1000),
    ]);
    const nextOpts = { categorie: categorie.data || [], stati: stati.data || [], progetti: progetti.data || [], prodotti: prodotti.data || [], utenti: utenti.data || [], tasks: tasksRes.data || [] };
    setOpts(nextOpts);
    if (isEditing) {
      setForm({
        titolo: task.titolo || "", descrizione: task.descrizione || "", categoria_id: task.categoria_id || "", stato_id: task.stato_id || "",
        progetto_id: task.progetto_id || "", prodotto_id: task.prodotto_id || "", assegnato_a_id: task.assegnato_a_id || "", deadline: task.deadline || "", bloccante_id: task.bloccante_id || "",
      });
      await Promise.all([loadAttivita(), loadCommenti(), loadAllegati(), loadChecklist()]);
    } else {
      const nuova = nextOpts.stati.find(s => s.nome === "Nuova");
      setForm({ titolo:"", descrizione:"", categoria_id:"", stato_id: nuova?.id || nextOpts.stati[0]?.id || "", progetto_id:"", prodotto_id:"", assegnato_a_id:"", deadline:"", bloccante_id:"" });
      setAttivita([]); setCommenti([]); setAllegati([]); setChecklist([]);
    }
  }

  function update(field, value){ setForm(c => ({...c, [field]: value})); }
  function mapName(list, id){ return list.find(x => x.id === id)?.nome || id || ""; }
  function fmt(date){ if(!date) return "-"; return new Date(date).toLocaleString("it-IT",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}); }
  function fileSize(bytes){ if(!bytes) return "-"; if(bytes<1024) return `${bytes} B`; if(bytes<1024*1024) return `${Math.round(bytes/1024)} KB`; return `${(bytes/1024/1024).toFixed(1)} MB`; }
  function blockerTask(){ return opts.tasks.find(x => x.id === form.bloccante_id); }
  function isTaskClosed(t){ const state = opts.stati.find(s => s.id === t?.stato_id); return Boolean(state?.chiusa) || ["chiusa","chiuso","completata","completato"].includes(String(state?.nome || "").toLowerCase()); }
  function isTryingToClose(){ const state = opts.stati.find(s => s.id === form.stato_id); return Boolean(state?.chiusa) || ["chiusa","chiuso","completata","completato"].includes(String(state?.nome || "").toLowerCase()); }

  async function loadAttivita(){ const {data,error}=await supabase.from("attivita_task").select("id,data_ora,tipo,campo,valore_precedente,valore_nuovo,note,utenti(nome,cognome)").eq("task_id",task.id).order("data_ora",{ascending:false}); if(error) console.error(error); setAttivita(data||[]); }
  async function loadCommenti(){ const {data,error}=await supabase.from("task_commenti").select("id,commento,created_at,utente_id,utenti(nome,cognome)").eq("task_id",task.id).order("created_at"); if(error) console.error(error); setCommenti(data||[]); }
  async function loadAllegati(){ const {data,error}=await supabase.from("task_allegati").select("id,nome_file,file_url,storage_path,tipo_file,dimensione_bytes,created_at,caricato_da_id,utenti:utenti!task_allegati_caricato_da_id_fkey(nome,cognome)").eq("task_id",task.id).order("created_at",{ascending:false}); if(error) console.error(error); setAllegati(data||[]); }
  async function loadChecklist(){ const {data,error}=await supabase.from("task_checklist").select("id,testo,completata,completata_il,completata_da_id,ordine,created_at,utenti:utenti!task_checklist_completata_da_id_fkey(nome,cognome)").eq("task_id",task.id).order("ordine").order("created_at"); if(error) console.error(error); setChecklist(data||[]); }

  async function addActivity(tipo, campo, valore_nuovo, note){ await supabase.from("attivita_task").insert({ task_id: task.id, utente_id: profile?.id || null, tipo, campo, valore_nuovo, note }); }

  async function handleSave(e){
    e.preventDefault();
    if(!form.titolo.trim()) return alert("Inserisci il titolo della task.");
    const blocker = blockerTask();
    if(blocker && !isTaskClosed(blocker) && isTryingToClose()) return alert(`Questa task è bloccata da: ${blocker.titolo || "task bloccante"}. Completa prima la task bloccante.`);
    setSaving(true);
    const payload = { titolo: form.titolo.trim(), descrizione: form.descrizione.trim() || null, categoria_id: form.categoria_id || null, stato_id: form.stato_id || null, progetto_id: form.progetto_id || null, prodotto_id: form.prodotto_id || null, assegnato_a_id: form.assegnato_a_id || null, deadline: form.deadline || null, bloccante_id: form.bloccante_id || null };
    if(isEditing){
      const {error}=await supabase.from("tasks").update({...payload, modificato_da_id: profile?.id || null}).eq("id", task.id);
      if(error){ console.error(error); setSaving(false); return alert("Errore durante il salvataggio."); }
      await addActivity("MODIFICA", "task", form.titolo.trim(), "Task modificata");
    } else {
      const {data,error}=await supabase.from("tasks").insert({...payload, creato_da_id: profile?.id || null, richiedente_id: profile?.id || null}).select("id").single();
      if(error){ console.error(error); setSaving(false); return alert("Errore durante il salvataggio."); }
      await supabase.from("attivita_task").insert({ task_id: data.id, utente_id: profile?.id || null, tipo:"CREAZIONE", campo:"task", valore_nuovo: form.titolo.trim(), note:"Task creata" });
    }
    setSaving(false); onSaved(); onClose();
  }

  async function addComment(e){
    e.preventDefault(); if(!newComment.trim()) return;
    const text = newComment.trim();
    const {error}=await supabase.from("task_commenti").insert({task_id:task.id,utente_id:profile?.id||null,commento:text});
    if(error){ console.error(error); return alert("Errore commento."); }
    await addActivity("COMMENTO","commenti",text,"Nuovo commento inserito");
    setNewComment(""); await Promise.all([loadCommenti(), loadAttivita()]);
  }

  async function deleteComment(id){ if(!confirm("Eliminare questo commento?")) return; await supabase.from("task_commenti").delete().eq("id",id); await loadCommenti(); }

  async function addChecklist(e){
    e.preventDefault(); if(!newChecklist.trim()) return;
    const text = newChecklist.trim();
    const {error}=await supabase.from("task_checklist").insert({task_id:task.id,testo:text,ordine:checklist.length+1});
    if(error){ console.error(error); return alert("Errore checklist."); }
    await addActivity("CHECKLIST","checklist",text,"Nuovo punto checklist");
    setNewChecklist(""); await Promise.all([loadChecklist(), loadAttivita()]);
  }

  async function toggleChecklist(item){
    const completed = !item.completata;
    const {error}=await supabase.from("task_checklist").update({completata:completed,completata_da_id:completed ? profile?.id || null : null,completata_il:completed ? new Date().toISOString() : null}).eq("id",item.id);
    if(error){ console.error(error); return alert("Errore checklist."); }
    await loadChecklist();
  }

  async function deleteChecklist(id){ if(!confirm("Eliminare questo punto checklist?")) return; await supabase.from("task_checklist").delete().eq("id",id); await loadChecklist(); }

  async function uploadAttachment(e){
    const file = e.target.files?.[0]; if(!file) return;
    setUploading(true);

    const currentUtenteId = await getCurrentUtenteId();
    if(!currentUtenteId){
      setUploading(false);
      e.target.value="";
      return alert("Utente non trovato nella tabella utenti. Verifica login e tabella utenti.");
    }

    const storagePath = `${task.id}/${Date.now()}-${file.name.replaceAll("/","-")}`;
    const up = await supabase.storage.from("task-attachments").upload(storagePath,file,{cacheControl:"3600",upsert:false});
    if(up.error){ console.error(up.error); setUploading(false); e.target.value=""; return alert("Errore caricamento allegato."); }
    const signed = await supabase.storage.from("task-attachments").createSignedUrl(storagePath,60*60*24*7);
    const ins = await supabase.from("task_allegati").insert({task_id:task.id,nome_file:file.name,file_url:signed.data?.signedUrl || storagePath,storage_path:storagePath,tipo_file:file.type || null,dimensione_bytes:file.size,caricato_da_id:currentUtenteId});
    if(ins.error){ console.error(ins.error); setUploading(false); e.target.value=""; return alert("Errore salvataggio allegato."); }
    await addActivity("ALLEGATO","allegati",file.name,"Nuovo allegato caricato");
    await Promise.all([loadAllegati(), loadAttivita()]); setUploading(false); e.target.value="";
  }

  async function openAttachment(a){
    if(!a.storage_path){ window.open(a.file_url,"_blank","noopener,noreferrer"); return; }
    const {data,error}=await supabase.storage.from("task-attachments").createSignedUrl(a.storage_path,600);
    if(error){ console.error(error); return alert("Errore apertura allegato."); }
    window.open(data.signedUrl,"_blank","noopener,noreferrer");
  }

  async function deleteAttachment(a){
    if(!confirm(`Eliminare l'allegato "${a.nome_file}"?`)) return;
    if(a.storage_path) await supabase.storage.from("task-attachments").remove([a.storage_path]);
    await supabase.from("task_allegati").delete().eq("id",a.id);
    await loadAllegati();
  }

  async function deleteTask(){
    if(!isEditing || !task?.id) return;
    if(!confirm("Eliminare questa task?\n\nVerranno eliminati anche commenti, checklist, storico attività, allegati e file fisici collegati.")) return;

    setSaving(true);

    const { data: files, error: filesError } = await supabase
      .from("task_allegati")
      .select("storage_path")
      .eq("task_id", task.id);

    if(filesError){
      setSaving(false);
      return alert(filesError.message);
    }

    const paths = (files || []).map(file => file.storage_path).filter(Boolean);

    if(paths.length){
      const { error: storageError } = await supabase.storage
        .from("task-attachments")
        .remove(paths);

      if(storageError){
        setSaving(false);
        return alert(`Errore eliminazione file: ${storageError.message}`);
      }
    }

    await supabase.from("task_commenti").delete().eq("task_id", task.id);
    await supabase.from("task_checklist").delete().eq("task_id", task.id);
    await supabase.from("attivita_task").delete().eq("task_id", task.id);
    await supabase.from("task_allegati").delete().eq("task_id", task.id);

    const { error } = await supabase.from("tasks").delete().eq("id", task.id);

    setSaving(false);

    if(error) return alert(error.message);

    onSaved?.();
    onClose?.();
  }

  if(!open) return null;
  const completed = checklist.filter(i=>i.completata).length;

  return <div className="modal-backdrop"><div className="task-modal task-modal-wide">
    <div className="modal-header"><div><h2>{isEditing ? "Modifica task" : "Nuova task"}</h2><p>{isEditing ? "Gestisci dettagli, attività, commenti, allegati e checklist." : "Crea una nuova attività."}</p></div><button className="modal-close" onClick={onClose} type="button"><X size={22}/></button></div>
    <div className="task-tabs">
      <button className={activeTab==="dettagli"?"active":""} onClick={()=>setActiveTab("dettagli")} type="button">Dettagli</button>
      <button className={activeTab==="attivita"?"active":""} onClick={()=>setActiveTab("attivita")} type="button" disabled={!isEditing}><History size={16}/>Attività</button>
      <button className={activeTab==="commenti"?"active":""} onClick={()=>setActiveTab("commenti")} type="button" disabled={!isEditing}><MessageCircle size={16}/>Commenti</button>
      <button className={activeTab==="allegati"?"active":""} onClick={()=>setActiveTab("allegati")} type="button" disabled={!isEditing}><Paperclip size={16}/>Allegati</button>
      <button className={activeTab==="checklist"?"active":""} onClick={()=>setActiveTab("checklist")} type="button" disabled={!isEditing}><CheckSquare size={16}/>Checklist {checklist.length ? `(${completed}/${checklist.length})` : ""}</button>
    </div>

    {activeTab==="dettagli" && <form onSubmit={handleSave} className="task-form">
      <div className="form-group full"><label>Titolo *</label><input value={form.titolo} onChange={e=>update("titolo",e.target.value)} autoFocus /></div>
      <div className="form-group full"><label>Descrizione</label><textarea value={form.descrizione} onChange={e=>update("descrizione",e.target.value)} /></div>
      <div className="form-group"><label>Categoria</label><select value={form.categoria_id} onChange={e=>update("categoria_id",e.target.value)}><option value="">Seleziona categoria</option>{opts.categorie.map(x=><option key={x.id} value={x.id}>{`${x.nome || ""} ${x.cognome || ""}`.trim() || x.email}</option>)}</select></div>
      <div className="form-group"><label>Stato</label><select value={form.stato_id} onChange={e=>update("stato_id",e.target.value)}><option value="">Seleziona stato</option>{opts.stati.map(x=><option key={x.id} value={x.id}>{`${x.nome || ""} ${x.cognome || ""}`.trim() || x.email}</option>)}</select></div>
      <div className="form-group"><label>Progetto</label><select value={form.progetto_id} onChange={e=>update("progetto_id",e.target.value)}><option value="">Nessun progetto</option>{opts.progetti.map(x=><option key={x.id} value={x.id}>{`${x.nome || ""} ${x.cognome || ""}`.trim() || x.email}</option>)}</select></div>
      <div className="form-group"><label>Prodotto</label><select value={form.prodotto_id} onChange={e=>update("prodotto_id",e.target.value)}><option value="">Nessun prodotto</option>{opts.prodotti.map(x=><option key={x.id} value={x.id}>{`${x.nome || ""} ${x.cognome || ""}`.trim() || x.email}</option>)}</select></div>
      <div className="form-group"><label>Assegnato a</label><select value={form.assegnato_a_id} onChange={e=>update("assegnato_a_id",e.target.value)}><option value="">Non assegnata</option>{opts.utenti.map(x=><option key={x.id} value={x.id}>{`${x.nome || ""} ${x.cognome || ""}`.trim() || x.email}</option>)}</select></div>
      <div className="form-group"><label>Deadline</label><input type="date" value={form.deadline} onChange={e=>update("deadline",e.target.value)} /></div>
      <div className="form-group full"><label>Task bloccante</label><select value={form.bloccante_id} onChange={e=>update("bloccante_id",e.target.value)}><option value="">Nessuna task bloccante</option>{opts.tasks.filter(x=>x.id!==task?.id).map(x=><option key={x.id} value={x.id}>{x.titolo}</option>)}</select>{blockerTask() && !isTaskClosed(blockerTask()) && <small className="form-hint">Task bloccata fino al completamento di: {blockerTask()?.titolo}</small>}</div>
      <div className="modal-actions">
        <button type="button" className="secondary-action" onClick={onClose}>Annulla</button>
        {isEditing && <button type="button" className="secondary-action danger" onClick={deleteTask} disabled={saving}><Trash2 size={16} /> Elimina</button>}
        <button type="submit" className="primary-action" disabled={saving}>{saving ? "Salvataggio..." : "Salva task"}</button>
      </div>
    </form>}

    {activeTab==="attivita" && <div className="task-tab-content"><div className="tab-title-row"><div><h3>Storico attività task</h3><p>Registro completo delle modifiche effettuate sulla task.</p></div><button type="button" className="secondary-action" onClick={loadAttivita}>Aggiorna storico</button></div>{attivita.length===0 ? <p className="empty-state">Nessuna attività registrata.</p> : <div className="activity-table"><div className="activity-table-head"><span>Data e ora</span><span>Utente</span><span>Azione</span><span>Campo</span><span>Da</span><span>A</span><span>Note</span></div>{attivita.map(i=><div className="activity-table-row" key={i.id}><span>{fmt(i.data_ora)}</span><span>{`${i.utenti?.nome || ""} ${i.utenti?.cognome || ""}`.trim() || "-"}</span><span className="activity-type">{i.tipo}</span><span>{i.campo||"-"}</span><span className="old-value">{i.valore_precedente||"—"}</span><span className="new-value">{i.valore_nuovo||"—"}</span><span>{i.note||"-"}</span></div>)}</div>}</div>}

    {activeTab==="commenti" && <div className="task-tab-content"><div className="tab-title-row"><div><h3>Commenti</h3><p>Messaggistica interna collegata alla task.</p></div></div><div className="comments-list">{commenti.length===0 ? <p className="empty-state">Nessun commento inserito.</p> : commenti.map(c=><div className="comment-card" key={c.id}><div><strong>{`${c.utenti?.nome || ""} ${c.utenti?.cognome || ""}`.trim() || "Utente"}</strong><span>{fmt(c.created_at)}</span></div><p>{c.commento}</p><button type="button" onClick={()=>deleteComment(c.id)}><Trash2 size={15}/></button></div>)}</div><form className="comment-form" onSubmit={addComment}><textarea value={newComment} onChange={e=>setNewComment(e.target.value)} placeholder="Scrivi un commento..."/><button className="primary-action"><Send size={17}/>Invia</button></form></div>}

    {activeTab==="allegati" && <div className="task-tab-content"><div className="tab-title-row"><div><h3>Allegati</h3><p>Carica documenti, immagini, PDF o file di lavoro.</p></div><label className="upload-button"><Upload size={17}/>{uploading?"Caricamento...":"Carica file"}<input type="file" onChange={uploadAttachment} disabled={uploading}/></label></div>{allegati.length===0 ? <p className="empty-state">Nessun allegato caricato.</p> : <div className="attachments-list">{allegati.map(a=><div className="attachment-row" key={a.id}><div><strong>{a.nome_file}</strong><span>{fileSize(a.dimensione_bytes)} · {`${a.utenti?.nome || ""} ${a.utenti?.cognome || ""}`.trim() || "Utente"} · {fmt(a.created_at)}</span></div><button type="button" onClick={()=>openAttachment(a)}><Download size={16}/></button><button type="button" className="danger" onClick={()=>deleteAttachment(a)}><Trash2 size={16}/></button></div>)}</div>}</div>}

    {activeTab==="checklist" && <div className="task-tab-content"><div className="tab-title-row"><div><h3>Checklist</h3><p>{completed} completate su {checklist.length} punti.</p></div></div><form className="checklist-form" onSubmit={addChecklist}><input value={newChecklist} onChange={e=>setNewChecklist(e.target.value)} placeholder="Aggiungi punto checklist..."/><button className="primary-action"><Plus size={17}/>Aggiungi</button></form>{checklist.length===0 ? <p className="empty-state">Nessun punto checklist inserito.</p> : <div className="checklist-list">{checklist.map(i=><div className={`checklist-row ${i.completata?"done":""}`} key={i.id}><label><input type="checkbox" checked={i.completata} onChange={()=>toggleChecklist(i)}/><span>{i.testo}</span></label><button type="button" onClick={()=>deleteChecklist(i.id)}><Trash2 size={16}/></button></div>)}</div>}</div>}
  </div></div>;
}

export default TaskModal;

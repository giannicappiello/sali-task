import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, Download, MessageSquare, Paperclip, Plus, Save, Search, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

const viewLabels = { month: "Mese", week: "Settimana", day: "Giorno" };
const defaultForm = { titolo: "", descrizione: "", deadline: new Date().toISOString().slice(0, 10), priorita: "Media", prodotto_id: "", progetto_id: "" };

function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDays(date, days) { const next = new Date(date); next.setDate(next.getDate() + days); return next; }
function iso(date) { return date.toISOString().slice(0, 10); }
function isDone(item) { return item.completato || String(item.stato || "").toLowerCase() === "completato"; }
function statusOf(item) { if (isDone(item)) return "Completato"; if (item.deadline && item.deadline < todayIso()) return "Scaduto"; if (item.deadline === todayIso()) return "Oggi"; return item.stato || "Aperto"; }
function statusClass(item) { const s = statusOf(item); if (s === "Completato") return "done"; if (s === "Scaduto") return "danger"; if (s === "Oggi") return "today"; return "open"; }
function formatDate(date) { if (!date) return "-"; return new Date(`${date}T00:00:00`).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" }); }

export default function Agenda() {
  const { profile, hasPermission, isAdmin } = useAuth();
  const adminMode = Boolean(isAdmin?.() || hasPermission?.("agenda.read.all"));
  const canWriteAgenda = Boolean(hasPermission?.("agenda.write") || adminMode);
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [query, setQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("all");
  const [users, setUsers] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [products, setProducts] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [comments, setComments] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState("");

  useEffect(() => { loadData(); }, [profile?.id, adminMode]);
  useEffect(() => { if (selected?.id) loadDetail(selected.id); }, [selected?.id]);

  async function loadData() {
    if (!profile?.id) return;

    const userDepartmentIds = profile?.reparto_ids || [];

    let reminderQuery = supabase
      .from("agenda_reminder")
      .select("*,utenti(id,nome,email)");

    if (!adminMode) {
      reminderQuery = reminderQuery.eq("utente_id", profile.id);
    }

    const [remRes, prodRes, projRes, projectDepartmentsRes, usersRes] = await Promise.all([
      reminderQuery.order("deadline", { ascending: true, nullsFirst: false }),
      supabase.from("prodotti").select("id,nome,codice").eq("attivo", true).order("nome").limit(500),
      supabase.from("v4_progetti").select("id,titolo").order("created_at", { ascending: false }).limit(500),
      supabase.from("v4_progetto_reparti").select("progetto_id,reparto_id"),
      adminMode ? supabase.from("utenti").select("id,nome,email,attivo").eq("attivo", true).order("nome") : Promise.resolve({ data: [], error: null }),
    ]);

    if (remRes.error) console.error("Agenda:", remRes.error);
    if (projRes.error) console.error("Progetti agenda:", projRes.error);
    if (projectDepartmentsRes.error) console.error("Reparti progetto agenda:", projectDepartmentsRes.error);
    if (usersRes.error) console.error("Utenti agenda:", usersRes.error);

    const allProjects = projRes.data || [];
    const projectDepartments = projectDepartmentsRes.data || [];

    const visibleProjects = adminMode
      ? allProjects
      : allProjects.filter((project) => {
          const deps = projectDepartments
            .filter((row) => row.progetto_id === project.id)
            .map((row) => row.reparto_id)
            .filter(Boolean);

          return deps.length === 0 || deps.some((id) => userDepartmentIds.includes(id));
        });

    setReminders(remRes.data || []);
    setProducts(prodRes.data || []);
    setProjects(visibleProjects);
    setUsers(usersRes.data || []);
  }

  async function loadDetail(id) {
    const [commentsRes, attachmentsRes] = await Promise.all([
      supabase.from("agenda_commenti").select("id,commento,created_at,utente_id").eq("reminder_id", id).order("created_at", { ascending: true }),
      supabase.from("agenda_allegati").select("*").eq("reminder_id", id).order("created_at", { ascending: false }),
    ]);
    setComments(commentsRes.data || []);
    setAttachments(attachmentsRes.data || []);
  }

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    let data = reminders;

    if (adminMode && selectedUserId !== "all") {
      data = data.filter((item) => item.utente_id === selectedUserId);
    }

    if (text) {
      data = data.filter((item) =>
        `${item.titolo || ""} ${item.descrizione || ""} ${products.find((p) => p.id === item.prodotto_id)?.nome || ""} ${projects.find((p) => p.id === item.progetto_id)?.titolo || ""} ${item.utenti?.nome || ""} ${item.utenti?.email || ""}`
          .toLowerCase()
          .includes(text)
      );
    }

    return data;
  }, [reminders, query, products, projects, adminMode, selectedUserId]);

  const calendarDays = useMemo(() => {
    if (view === "day") return [{ date: new Date(`${selectedDate}T00:00:00`), key: selectedDate }];
    if (view === "week") {
      const base = new Date(cursor);
      const day = (base.getDay() + 6) % 7;
      const start = addDays(base, -day);
      return Array.from({ length: 7 }, (_, i) => { const date = addDays(start, i); return { date, key: iso(date) }; });
    }
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - offset);
    return Array.from({ length: 42 }, (_, i) => { const date = addDays(start, i); return { date, key: iso(date), inMonth: date.getMonth() === month }; });
  }, [view, cursor, selectedDate]);

  const remindersByDay = useMemo(() => {
    const map = new Map();
    filtered.forEach((item) => {
      const key = item.deadline || "senza-data";
      map.set(key, [...(map.get(key) || []), item]);
    });
    return map;
  }, [filtered]);

  function canEditReminder(item) {
    if (!item?.id) return canWriteAgenda;
    return adminMode || item.utente_id === profile?.id;
  }

  function openNew(date = selectedDate) {
    if (!canWriteAgenda) return alert("Non hai i permessi per creare reminder.");
    setForm({ ...defaultForm, deadline: date || todayIso() });
    setSelected(null);
    setFormOpen(true);
  }

  function openEdit(item) {
    if (!canEditReminder(item)) return alert("Non hai i permessi per modificare questo reminder.");
    setSelected(item);
    setForm({
      titolo: item.titolo || "",
      descrizione: item.descrizione || "",
      deadline: item.deadline || todayIso(),
      priorita: item.priorita || "Media",
      prodotto_id: item.prodotto_id || "",
      progetto_id: item.progetto_id || "",
    });
    setFormOpen(true);
  }

  async function saveReminder(e) {
    e.preventDefault();
    if (!canWriteAgenda) return alert("Non hai i permessi per modificare l'agenda.");
    if (selected?.id && !canEditReminder(selected)) return alert("Non hai i permessi per modificare questo reminder.");
    if (!form.titolo.trim()) return alert("Inserisci il titolo.");
    setSaving(true);
    const payload = {
      utente_id: selected?.utente_id || profile.id,
      titolo: form.titolo.trim(),
      descrizione: form.descrizione.trim() || null,
      deadline: form.deadline || null,
      priorita: form.priorita,
      prodotto_id: form.prodotto_id || null,
      progetto_id: form.progetto_id || null,
      stato: selected?.stato || "Aperto",
      updated_at: new Date().toISOString(),
    };
    const request = selected?.id ? supabase.from("agenda_reminder").update(payload).eq("id", selected.id) : supabase.from("agenda_reminder").insert(payload).select().single();
    const { data, error } = await request;
    setSaving(false);
    if (error) return alert(`Errore salvataggio: ${error.message}`);
    await loadData();
    if (data?.id) setSelected(data);
    setFormOpen(false);
  }

  async function completeReminder(item) {
    if (!canEditReminder(item)) return alert("Non hai i permessi per completare questo reminder.");
    const { error } = await supabase.from("agenda_reminder").update({ completato: true, stato: "Completato", completato_il: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", item.id);
    if (error) return alert(error.message);
    await loadData();
    if (selected?.id === item.id) setSelected({ ...selected, completato: true, stato: "Completato" });
  }

  async function saveComment(e) {
    e.preventDefault();
    if (!selected?.id || !comment.trim()) return;
    if (!canEditReminder(selected)) return alert("Non hai i permessi per commentare questo reminder.");
    const { error } = await supabase.from("agenda_commenti").insert({ reminder_id: selected.id, utente_id: profile.id, commento: comment.trim() });
    if (error) return alert(error.message);
    setComment("");
    await loadDetail(selected.id);
  }

  async function uploadAttachment(file) {
    if (!selected?.id || !file) return;
    if (!canEditReminder(selected)) return alert("Non hai i permessi per allegare file a questo reminder.");
    const path = `${profile.id}/agenda/${selected.id}/${Date.now()}-${file.name}`;
    const uploaded = await supabase.storage.from("allegati").upload(path, file, { upsert: true });
    if (uploaded.error) return alert(`Errore upload. Verifica bucket Storage "allegati". ${uploaded.error.message}`);
    const { data } = supabase.storage.from("allegati").getPublicUrl(path);
    const { error } = await supabase.from("agenda_allegati").insert({ reminder_id: selected.id, utente_id: profile.id, nome_file: file.name, file_url: data.publicUrl, tipo_file: file.type });
    if (error) return alert(error.message);
    await loadDetail(selected.id);
  }

  function daySummary(items) {
    const open = items.filter((item) => !isDone(item));
    const done = items.filter(isDone);
    return { open: open.length, done: done.length, danger: open.filter((item) => statusOf(item) === "Scaduto").length };
  }

  function movePeriod(direction) {
    const multiplier = direction === "next" ? 1 : -1;
    const days = view === "day" ? 1 : view === "week" ? 7 : 30;
    const nextCursor = addDays(cursor, multiplier * days);
    setCursor(nextCursor);
    if (view !== "month") setSelectedDate(iso(nextCursor));
  }

  function changeSelectedDate(value) {
    if (!value) return;
    const next = new Date(`${value}T00:00:00`);
    setSelectedDate(value);
    setCursor(next);
  }

  return (
    <div className="agenda-page v4-page">
      <div className="page-title-row">
        <div><h1>Agenda personale</h1><p>Reminder privati visibili solo all'utente e agli amministratori.</p></div>
        {canWriteAgenda && <button className="primary-action" onClick={() => openNew()}><Plus size={18} />Nuovo reminder</button>}
      </div>

      <div className="v4-toolbar agenda-toolbar-clear">
        <div className="task-search"><Search size={18} /><input placeholder="Cerca tutto in agenda..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        {adminMode && (
          <select className="filter-chip" value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
            <option value="all">Tutti gli utenti</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.nome || user.email}</option>
            ))}
          </select>
        )}
        <div className="planning-view-tabs">
          {Object.entries(viewLabels).map(([key, label]) => <button key={key} className={`filter-chip ${view === key ? "active" : ""}`} onClick={() => setView(key)}>{label}</button>)}
        </div>
        <div className="planning-navigation" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button className="filter-chip" onClick={() => movePeriod("prev")} title="Periodo precedente"><ChevronLeft size={16} /> Indietro</button>
          <input className="filter-chip" type="date" value={selectedDate} onChange={(e) => changeSelectedDate(e.target.value)} />
          <button className="filter-chip" onClick={() => { const now = new Date(); setCursor(now); setSelectedDate(todayIso()); }}>Oggi</button>
          <button className="filter-chip" onClick={() => movePeriod("next")} title="Periodo successivo">Avanti <ChevronRight size={16} /></button>
        </div>
      </div>

      <div className="planning-legend panel" style={{ display: "flex", gap: "14px", alignItems: "center", flexWrap: "wrap", padding: "10px 14px", marginBottom: "12px" }}>
        <strong>Legenda:</strong>
        <span><span className="dot open">•</span> Aperti</span>
        <span><span className="dot today">•</span> Oggi</span>
        <span><span className="dot danger">•</span> Scaduti</span>
        <span><span className="dot done">•</span> Completati</span>
      </div>

      <div className={`planning-grid ${view}`}>
        {calendarDays.map((day) => {
          const items = remindersByDay.get(day.key) || [];
          const summary = daySummary(items);
          return (
            <button key={day.key} className={`planning-day ${day.inMonth === false ? "muted" : ""} ${day.key === selectedDate ? "selected" : ""}`} onClick={() => { setSelectedDate(day.key); setView(view === "month" ? "day" : view); }}>
              <strong>{formatDate(day.key)}</strong>
              {view === "month" ? (
                <div className="planning-counters"><span className="dot open">{summary.open}</span><span className="dot danger">{summary.danger}</span><span className="dot done">{summary.done}</span></div>
              ) : (
                <div className="planning-items">{items.slice(0, 5).map((item) => <span key={item.id} className={`planning-chip ${statusClass(item)}`}>{item.titolo}</span>)}</div>
              )}
            </button>
          );
        })}
      </div>

      <div className="v4-split">
        <div className="panel">
          <div className="panel-header"><h3>Dettagli del giorno · {formatDate(selectedDate)}</h3></div>
          {(remindersByDay.get(selectedDate) || []).length === 0 ? <p className="empty-text">Nessun reminder in questa giornata.</p> : (
            <div className="v4-list">{(remindersByDay.get(selectedDate) || []).map((item) => (
              <div key={item.id} className={`v4-list-row ${statusClass(item)}`}>
                <button className="v4-list-main" onClick={() => { setSelected(item); setFormOpen(false); }}><strong>{item.titolo}</strong><span>{item.descrizione || "Nessuna descrizione"}</span><small>{adminMode && item.utenti?.nome ? `${item.utenti.nome} · ` : ""}{products.find((p) => p.id === item.prodotto_id)?.nome || ""} {projects.find((p) => p.id === item.progetto_id)?.titolo ? `· ${projects.find((p) => p.id === item.progetto_id)?.titolo}` : ""}</small></button>
                <span className={`status-pill ${statusClass(item)}`}>{statusOf(item)}</span>
                {!isDone(item) && canEditReminder(item) && <button className="icon-action success" onClick={() => completeReminder(item)}><CheckCircle2 size={18} /></button>}
                {canEditReminder(item) && <button className="icon-action" onClick={() => openEdit(item)}>Modifica</button>}
              </div>
            ))}</div>
          )}
        </div>

        <div className="panel detail-panel">
          <div className="panel-header"><h3>{selected ? selected.titolo : "Reminder selezionato"}</h3>{selected && <span className={`status-pill ${statusClass(selected)}`}>{statusOf(selected)}</span>}</div>
          {!selected ? <p className="empty-text">Seleziona un reminder per vedere commenti e allegati.</p> : (
            <>
              <p className="detail-description">{selected.descrizione || "Nessuna descrizione."}</p>
              <div className="mini-meta"><span><Clock size={15} /> {formatDate(selected.deadline)}</span><span>Priorità: {selected.priorita || "Media"}</span></div>
              <form className="comment-form" onSubmit={saveComment}><input placeholder="Aggiungi commento..." value={comment} onChange={(e) => setComment(e.target.value)} /><button><MessageSquare size={16} />Invia</button></form>
              <div className="comments-box">{comments.map((item) => <p key={item.id}><strong>{item.utente_id === profile.id ? "Tu" : "Utente"}</strong> {item.commento}<small>{new Date(item.created_at).toLocaleString("it-IT")}</small></p>)}</div>
              <label className="upload-box"><Paperclip size={18} />Carica allegato<input type="file" hidden onChange={(e) => uploadAttachment(e.target.files?.[0])} /></label>
              <div className="attachments-list">{attachments.map((file) => <a key={file.id} href={file.file_url} target="_blank" rel="noreferrer"><Download size={16} />{file.nome_file}</a>)}</div>
            </>
          )}
        </div>
      </div>

      {formOpen && (
        <div className="modal-backdrop"><form className="modal-card v4-modal" onSubmit={saveReminder}>
          <div className="modal-header"><h2>{selected ? "Modifica reminder" : "Nuovo reminder"}</h2><button type="button" onClick={() => setFormOpen(false)}><X size={20} /></button></div>
          <label>Titolo<input value={form.titolo} onChange={(e) => setForm({ ...form, titolo: e.target.value })} /></label>
          <label>Descrizione<textarea rows="4" value={form.descrizione} onChange={(e) => setForm({ ...form, descrizione: e.target.value })} /></label>
          <div className="form-grid-2"><label>Deadline<input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></label><label>Priorità<select value={form.priorita} onChange={(e) => setForm({ ...form, priorita: e.target.value })}><option>Bassa</option><option>Media</option><option>Alta</option></select></label></div>
          <div className="form-grid-2"><label>Prodotto<select value={form.prodotto_id} onChange={(e) => setForm({ ...form, prodotto_id: e.target.value })}><option value="">Nessuno</option>{products.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label><label>Progetto<select value={form.progetto_id} onChange={(e) => setForm({ ...form, progetto_id: e.target.value })}><option value="">Nessuno</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.titolo}</option>)}</select></label></div>
          <button className="primary-action" disabled={saving}><Save size={18} />{saving ? "Salvataggio..." : "Salva reminder"}</button>
        </form></div>
      )}
    </div>
  );
}

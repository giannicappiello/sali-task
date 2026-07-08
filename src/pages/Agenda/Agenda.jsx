import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Clock, Download, MessageSquare, Paperclip, Plus, Save, Search, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

const defaultForm = {
  titolo: "",
  descrizione: "",
  deadline: new Date().toISOString().slice(0, 10),
  prodotto_id: "",
  progetto_id: "",
  stato: "Aperto",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function isDone(item) {
  return Boolean(item?.completato) || String(item?.stato || "").toLowerCase() === "completato";
}

function statusOf(item) {
  if (isDone(item)) return "Completato";
  const deadline = dateOnly(item?.deadline);
  if (deadline && deadline < todayIso()) return "Scaduto";
  if (deadline === todayIso()) return "Oggi";
  return item?.stato || "Aperto";
}

function statusClass(item) {
  const status = statusOf(item);
  if (status === "Completato") return "done";
  if (status === "Scaduto") return "danger";
  if (status === "Oggi") return "today";
  return "open";
}

function formatDate(value) {
  const date = dateOnly(value);
  if (!date) return "Senza deadline";
  return new Date(`${date}T00:00:00`).toLocaleDateString("it-IT", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function Agenda() {
  const [params, setParams] = useSearchParams();
  const { profile, hasPermission, isAdmin } = useAuth();
  const adminMode = Boolean(isAdmin?.() || hasPermission?.("agenda.read.all"));
  const canWriteAgenda = Boolean(hasPermission?.("agenda.write") || adminMode);

  const [query, setQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [profile?.id, adminMode]);

  useEffect(() => {
    if (selected?.id) loadDetail(selected.id);
    else {
      setComments([]);
      setAttachments([]);
    }
  }, [selected?.id]);

  useEffect(() => {
    if (params.get("new") === "1" && canWriteAgenda) {
      openNew();
      setParams({}, { replace: true });
    }
  }, [params, canWriteAgenda]);

  useEffect(() => {
    const reminderId = params.get("reminder");
    if (!reminderId || !reminders.length) return;
    const found = reminders.find((item) => item.id === reminderId);
    if (found) openEdit(found);
  }, [params, reminders]);

  function userName(userId) {
    const user = users.find((item) => item.id === userId);
    return user?.nome || user?.email || "Utente";
  }

  async function loadData() {
    if (!profile?.id) return;
    setLoading(true);

    const userDepartmentIds = profile?.reparto_ids || [];

    let reminderQuery = supabase.from("agenda_reminder").select("*");
    if (!adminMode) reminderQuery = reminderQuery.eq("utente_id", profile.id);

    const [remRes, prodRes, projRes, projectDepartmentsRes, usersRes] = await Promise.all([
      reminderQuery.order("deadline", { ascending: true, nullsFirst: false }),
      supabase.from("prodotti").select("id,nome,codice,attivo").order("nome").limit(5000),
      supabase.from("v4_progetti").select("id,titolo").order("created_at", { ascending: false }).limit(500),
      supabase.from("v4_progetto_reparti").select("progetto_id,reparto_id"),
      supabase.from("utenti").select("id,nome,email,attivo").order("nome"),
    ]);

    if (remRes.error) console.error("Reminder agenda_reminder:", remRes.error.message);
    if (prodRes.error) console.error("Prodotti reminder:", prodRes.error.message);
    if (projRes.error) console.error("Progetti reminder:", projRes.error.message);
    if (projectDepartmentsRes.error) console.error("Reparti progetto reminder:", projectDepartmentsRes.error.message);
    if (usersRes.error) console.error("Utenti reminder:", usersRes.error.message);

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
    setProducts((prodRes.data || []).filter((item) => item.attivo !== false));
    setProjects(visibleProjects);
    setUsers((usersRes.data || []).filter((item) => item.attivo !== false));
    setLoading(false);
  }

  async function loadDetail(id) {
    const [commentsRes, attachmentsRes] = await Promise.all([
      supabase.from("agenda_commenti").select("id,commento,created_at,utente_id").eq("reminder_id", id).order("created_at", { ascending: true }),
      supabase.from("agenda_allegati").select("*").eq("reminder_id", id).order("created_at", { ascending: false }),
    ]);

    if (commentsRes.error) console.error("Commenti reminder:", commentsRes.error.message);
    if (attachmentsRes.error) console.error("Allegati reminder:", attachmentsRes.error.message);

    setComments(commentsRes.data || []);
    setAttachments(attachmentsRes.data || []);
  }

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    let data = reminders;

    if (adminMode && selectedUserId !== "all") data = data.filter((item) => item.utente_id === selectedUserId);

    if (selectedStatus !== "all") {
      data = data.filter((item) => {
        if (selectedStatus === "Scaduto") return statusOf(item) === "Scaduto";
        if (selectedStatus === "Oggi") return statusOf(item) === "Oggi";
        if (selectedStatus === "Completato") return isDone(item);
        return String(item.stato || "Aperto").toLowerCase() === selectedStatus.toLowerCase();
      });
    }

    if (text) {
      data = data.filter((item) => {
        const productName = products.find((p) => p.id === item.prodotto_id)?.nome || "";
        const projectTitle = projects.find((p) => p.id === item.progetto_id)?.titolo || "";
        return `${item.titolo || ""} ${item.descrizione || ""} ${productName} ${projectTitle} ${userName(item.utente_id)}`
          .toLowerCase()
          .includes(text);
      });
    }

    return [...data].sort(
      (a, b) =>
        String(dateOnly(a.deadline) || "9999-12-31").localeCompare(String(dateOnly(b.deadline) || "9999-12-31")) ||
        String(a.titolo || "").localeCompare(String(b.titolo || ""))
    );
  }, [reminders, query, products, projects, users, adminMode, selectedUserId, selectedStatus]);

  const remindersByDay = useMemo(() => {
    const map = new Map();
    filtered.forEach((item) => {
      const key = dateOnly(item.deadline) || "senza-data";
      map.set(key, [...(map.get(key) || []), item]);
    });
    return Array.from(map.entries());
  }, [filtered]);

  function canEditReminder(item) {
    if (!item?.id) return canWriteAgenda;
    return adminMode || item.utente_id === profile?.id;
  }

  function openNew() {
    if (!canWriteAgenda) return alert("Non hai i permessi per creare reminder.");
    setForm({ ...defaultForm, deadline: todayIso() });
    setSelected(null);
    setComments([]);
    setAttachments([]);
    setComment("");
    setFormOpen(true);
  }

  function openEdit(item) {
    if (!canEditReminder(item)) return alert("Non hai i permessi per modificare questo reminder.");
    setSelected(item);
    setForm({
      titolo: item.titolo || "",
      descrizione: item.descrizione || "",
      deadline: dateOnly(item.deadline) || todayIso(),
      prodotto_id: item.prodotto_id || "",
      progetto_id: item.progetto_id || "",
      stato: item.stato || "Aperto",
    });
    setComment("");
    setFormOpen(true);
  }

  async function saveReminder(e) {
    e.preventDefault();
    if (!canWriteAgenda) return alert("Non hai i permessi per modificare i reminder.");
    if (selected?.id && !canEditReminder(selected)) return alert("Non hai i permessi per modificare questo reminder.");
    if (!form.titolo.trim()) return alert("Inserisci il titolo.");

    setSaving(true);
    const payload = {
      utente_id: selected?.utente_id || profile.id,
      titolo: form.titolo.trim(),
      descrizione: form.descrizione.trim() || null,
      deadline: form.deadline || null,
      prodotto_id: form.prodotto_id || null,
      progetto_id: form.progetto_id || null,
      stato: form.stato || "Aperto",
      updated_at: new Date().toISOString(),
    };

    const request = selected?.id
      ? supabase.from("agenda_reminder").update(payload).eq("id", selected.id).select().single()
      : supabase.from("agenda_reminder").insert(payload).select().single();

    const { data, error } = await request;
    setSaving(false);
    if (error) return alert(`Errore salvataggio: ${error.message}`);

    await loadData();
    if (data?.id) {
      setSelected(data);
      await loadDetail(data.id);
    }
  }

  async function deleteReminder(item) {
    if (!canEditReminder(item)) return alert("Non hai i permessi per eliminare questo reminder.");
    if (!confirm("Eliminare questo reminder?")) return;
    const { error } = await supabase.from("agenda_reminder").delete().eq("id", item.id);
    if (error) return alert(error.message);
    setSelected(null);
    setFormOpen(false);
    await loadData();
  }

  async function completeReminder(item) {
    if (!canEditReminder(item)) return alert("Non hai i permessi per completare questo reminder.");
    const { error } = await supabase
      .from("agenda_reminder")
      .update({ completato: true, stato: "Completato", completato_il: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", item.id);
    if (error) return alert(error.message);
    await loadData();
    const updated = { ...item, completato: true, stato: "Completato" };
    if (selected?.id === item.id) setSelected(updated);
  }

  async function saveComment(e) {
    e.preventDefault();
    if (!selected?.id) return alert("Salva prima il reminder, poi aggiungi il commento.");
    if (!comment.trim()) return;
    if (!canEditReminder(selected)) return alert("Non hai i permessi per commentare questo reminder.");

    const { error } = await supabase.from("agenda_commenti").insert({
      reminder_id: selected.id,
      utente_id: profile.id,
      commento: comment.trim(),
    });
    if (error) return alert(error.message);
    setComment("");
    await loadDetail(selected.id);
  }

  async function uploadAttachment(file) {
    if (!selected?.id) return alert("Salva prima il reminder, poi carica gli allegati.");
    if (!file) return;
    if (!canEditReminder(selected)) return alert("Non hai i permessi per allegare file a questo reminder.");

    const cleanFileName = file.name.replaceAll("/", "-");
    const path = `${profile.id}/agenda/${selected.id}/${Date.now()}-${cleanFileName}`;
    const uploaded = await supabase.storage.from("allegati").upload(path, file, { upsert: true });
    if (uploaded.error) return alert(`Errore upload. Verifica bucket Storage "allegati". ${uploaded.error.message}`);

    const { data } = supabase.storage.from("allegati").getPublicUrl(path);
    const { error } = await supabase.from("agenda_allegati").insert({
      reminder_id: selected.id,
      utente_id: profile.id,
      nome_file: file.name,
      file_url: data.publicUrl,
      tipo_file: file.type || null,
    });
    if (error) return alert(error.message);
    await loadDetail(selected.id);
  }

  return (
    <div className="agenda-page v4-page">
      <div className="page-title-row">
        <div>
          <h1>Reminder</h1>
          <p>Elenco dei reminder organizzati per data deadline.</p>
        </div>
        {canWriteAgenda && (
          <button className="primary-action" onClick={openNew}>
            <Plus size={18} /> Nuovo reminder
          </button>
        )}
      </div>

      <div className="v4-toolbar agenda-toolbar-clear">
        <div className="task-search">
          <Search size={18} />
          <input placeholder="Cerca reminder..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {adminMode && (
          <select className="filter-chip" value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
            <option value="all">Tutti gli utenti</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.nome || user.email}</option>
            ))}
          </select>
        )}
        <select className="filter-chip" value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
          <option value="all">Tutti gli stati</option>
          <option value="Aperto">Aperto</option>
          <option value="In lavorazione">In lavorazione</option>
          <option value="Scaduto">Scaduto</option>
          <option value="Completato">Completato</option>
        </select>
      </div>

      <div className="v4-split">
        <div className="panel">
          <div className="panel-header">
            <h3>Tutti i reminder</h3>
            <span>{filtered.length} reminder</span>
          </div>
          {loading ? (
            <p className="empty-text">Caricamento reminder...</p>
          ) : filtered.length === 0 ? (
            <p className="empty-text">Nessun reminder trovato.</p>
          ) : (
            <div className="reminder-deadline-list">
              {remindersByDay.map(([day, items]) => (
                <section key={day} className="reminder-date-group">
                  <h4>{formatDate(day === "senza-data" ? null : day)}</h4>
                  <div className="v4-list">
                    {items.map((item) => (
                      <div key={item.id} className={`v4-list-row ${statusClass(item)}`}>
                        <button className="v4-list-main" onClick={() => openEdit(item)}>
                          <strong>{item.titolo}</strong>
                          <span>{item.descrizione || "Nessuna descrizione"}</span>
                          <small>
                            {adminMode ? `${userName(item.utente_id)} · ` : ""}
                            {products.find((p) => p.id === item.prodotto_id)?.nome || ""}
                            {projects.find((p) => p.id === item.progetto_id)?.titolo ? ` · ${projects.find((p) => p.id === item.progetto_id)?.titolo}` : ""}
                          </small>
                        </button>
                        <span className={`status-pill ${statusClass(item)}`}>{statusOf(item)}</span>
                        {!isDone(item) && canEditReminder(item) && (
                          <button className="icon-action success" onClick={() => completeReminder(item)}>
                            <CheckCircle2 size={18} />
                          </button>
                        )}
                        {canEditReminder(item) && <button className="icon-action" onClick={() => openEdit(item)}>Modifica</button>}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="panel detail-panel">
          <div className="panel-header">
            <h3>{selected ? selected.titolo : "Reminder selezionato"}</h3>
            {selected && <span className={`status-pill ${statusClass(selected)}`}>{statusOf(selected)}</span>}
          </div>
          {!selected ? (
            <p className="empty-text">Seleziona un reminder per vedere commenti e allegati.</p>
          ) : (
            <>
              <p className="detail-description">{selected.descrizione || "Nessuna descrizione."}</p>
              <div className="mini-meta"><span><Clock size={15} /> {formatDate(selected.deadline)}</span></div>
              <form className="comment-form" onSubmit={saveComment}>
                <input placeholder="Aggiungi commento..." value={comment} onChange={(e) => setComment(e.target.value)} />
                <button><MessageSquare size={16} /> Invia</button>
              </form>
              <div className="comments-box">
                {comments.length === 0 ? <p className="empty-text">Nessun commento.</p> : comments.map((item) => (
                  <p key={item.id}>
                    <strong>{item.utente_id === profile.id ? "Tu" : userName(item.utente_id)}</strong> {item.commento}
                    <small>{new Date(item.created_at).toLocaleString("it-IT")}</small>
                  </p>
                ))}
              </div>
              <label className="upload-box">
                <Paperclip size={18} /> Carica allegato
                <input type="file" hidden onChange={(e) => uploadAttachment(e.target.files?.[0])} />
              </label>
              <div className="attachments-list">
                {attachments.length === 0 ? <p className="empty-text">Nessun allegato.</p> : attachments.map((file) => (
                  <a key={file.id} href={file.file_url} target="_blank" rel="noreferrer"><Download size={16} /> {file.nome_file}</a>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {formOpen && (
        <div className="modal-backdrop">
          <div className="modal-card v4-modal">
            <div className="modal-header">
              <h2>{selected ? "Modifica reminder" : "Nuovo reminder"}</h2>
              <button type="button" onClick={() => setFormOpen(false)}><X size={20} /></button>
            </div>

            <label>Titolo<input value={form.titolo} onChange={(e) => setForm({ ...form, titolo: e.target.value })} /></label>
            <label>Descrizione<textarea rows="4" value={form.descrizione} onChange={(e) => setForm({ ...form, descrizione: e.target.value })} /></label>
            <label>Deadline<input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></label>
            <label>Stato<select value={form.stato} onChange={(e) => setForm({ ...form, stato: e.target.value })}>
              <option value="Aperto">Aperto</option>
              <option value="In lavorazione">In lavorazione</option>
              <option value="Completato">Completato</option>
              <option value="Scaduto">Scaduto</option>
            </select></label>
            <div className="form-grid-2">
              <label>Prodotto<select value={form.prodotto_id} onChange={(e) => setForm({ ...form, prodotto_id: e.target.value })}><option value="">Nessuno</option>{products.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
              <label>Progetto<select value={form.progetto_id} onChange={(e) => setForm({ ...form, progetto_id: e.target.value })}><option value="">Nessuno</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.titolo}</option>)}</select></label>
            </div>

            <div className="dashboard-message-actions">
              {selected && !isDone(selected) && <button type="button" className="secondary-action" onClick={() => completeReminder(selected)}><CheckCircle2 size={18} /> Evadi</button>}
              {selected && <button type="button" className="secondary-action danger" onClick={() => deleteReminder(selected)}>Elimina</button>}
              <button type="button" className="primary-action" disabled={saving} onClick={saveReminder}><Save size={18} /> {saving ? "Salvataggio..." : "Salva reminder"}</button>
            </div>

            <div className="modal-section">
              <h3>Commenti</h3>
              {!selected?.id ? <p className="empty-text">Salva il reminder per aggiungere commenti.</p> : (
                <>
                  <form className="comment-form" onSubmit={saveComment}>
                    <input placeholder="Aggiungi commento..." value={comment} onChange={(e) => setComment(e.target.value)} />
                    <button type="submit"><MessageSquare size={16} /> Invia</button>
                  </form>
                  <div className="comments-box">
                    {comments.length === 0 ? <p className="empty-text">Nessun commento.</p> : comments.map((item) => (
                      <p key={item.id}>
                        <strong>{item.utente_id === profile.id ? "Tu" : userName(item.utente_id)}</strong> {item.commento}
                        <small>{new Date(item.created_at).toLocaleString("it-IT")}</small>
                      </p>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="modal-section">
              <h3>Allegati</h3>
              {!selected?.id ? <p className="empty-text">Salva il reminder per caricare allegati.</p> : (
                <>
                  <label className="upload-box">
                    <Paperclip size={18} /> Carica allegato
                    <input type="file" hidden onChange={(e) => uploadAttachment(e.target.files?.[0])} />
                  </label>
                  <div className="attachments-list">
                    {attachments.length === 0 ? <p className="empty-text">Nessun allegato.</p> : attachments.map((file) => (
                      <a key={file.id} href={file.file_url} target="_blank" rel="noreferrer"><Download size={16} /> {file.nome_file}</a>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
  prodotti: [],
  reparto_ids: [],
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
  const [departments, setDepartments] = useState([]);
  const [reminderDepartments, setReminderDepartments] = useState([]);
  const [reminderProducts, setReminderProducts] = useState([]);
  const [productQuery, setProductQuery] = useState("");
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
    if (!found) return;

    setSelected(found);
    if (params.get("edit") === "1") {
      openEdit(found);
    }
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

    const [remRes, prodRes, projRes, projectDepartmentsRes, usersRes, departmentsRes, reminderDepartmentsRes, reminderProductsRes] = await Promise.all([
      reminderQuery.order("deadline", { ascending: true, nullsFirst: false }),
      supabase.from("prodotti").select("id,nome,codice,attivo").order("nome").limit(5000),
      supabase.from("v4_progetti").select("id,titolo").order("created_at", { ascending: false }).limit(500),
      supabase.from("v4_progetto_reparti").select("progetto_id,reparto_id"),
      supabase.from("utenti").select("id,nome,email,attivo").order("nome"),
      supabase.from("reparti").select("id,nome,attivo").order("nome"),
      supabase.from("agenda_reminder_reparti").select("id,reminder_id,reparto_id,completato,completato_at,completato_da,note_completamento"),
      supabase.from("agenda_reminder_prodotti").select("id,reminder_id,prodotto_id,prodotto_nome"),
    ]);

    if (remRes.error) console.error("Reminder agenda_reminder:", remRes.error.message);
    if (prodRes.error) console.error("Prodotti reminder:", prodRes.error.message);
    if (projRes.error) console.error("Progetti reminder:", projRes.error.message);
    if (projectDepartmentsRes.error) console.error("Reparti progetto reminder:", projectDepartmentsRes.error.message);
    if (usersRes.error) console.error("Utenti reminder:", usersRes.error.message);
    if (departmentsRes.error) console.error("Reparti reminder:", departmentsRes.error.message);
    if (reminderDepartmentsRes.error) console.error("Reparti collegati reminder:", reminderDepartmentsRes.error.message);
    if (reminderProductsRes.error) console.error("Prodotti collegati reminder:", reminderProductsRes.error.message);

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

    const allReminderDepartments = reminderDepartmentsRes.data || [];
    const allReminderProducts = reminderProductsRes.data || [];
    const visibleReminders = adminMode
      ? (remRes.data || [])
      : (remRes.data || []).filter((item) => {
          if (item.utente_id === profile.id) return true;
          const ids = allReminderDepartments.filter((row) => row.reminder_id === item.id).map((row) => row.reparto_id).filter(Boolean);
          return ids.some((id) => userDepartmentIds.includes(id));
        });
    const visibleReminderIds = new Set(visibleReminders.map((item) => item.id));

    setReminders(visibleReminders);
    setProducts((prodRes.data || []).filter((item) => item.attivo !== false));
    setProjects(visibleProjects);
    setUsers((usersRes.data || []).filter((item) => item.attivo !== false));
    setDepartments((departmentsRes.data || []).filter((item) => item.attivo !== false));
    setReminderDepartments(allReminderDepartments.filter((row) => visibleReminderIds.has(row.reminder_id)));
    setReminderProducts(allReminderProducts.filter((row) => visibleReminderIds.has(row.reminder_id)));
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

  function getReminderProductIds(reminderId, fallbackProductId = null) {
    const ids = reminderProducts.filter((row) => row.reminder_id === reminderId && row.prodotto_id).map((row) => row.prodotto_id);
    if (!ids.length && fallbackProductId) return [fallbackProductId];
    return ids;
  }

  function getReminderDepartmentIds(reminderId) {
    return reminderDepartments.filter((row) => row.reminder_id === reminderId && row.reparto_id).map((row) => row.reparto_id);
  }

  function getReminderProductNames(item) {
    const ids = getReminderProductIds(item.id, item.prodotto_id);
    return ids.map((id) => products.find((product) => product.id === id)?.nome).filter(Boolean).join(", ");
  }

  function getReminderDepartmentNames(item) {
    const ids = getReminderDepartmentIds(item.id);
    return ids.map((id) => departments.find((department) => department.id === id)?.nome).filter(Boolean).join(", ");
  }

  function getReminderDepartmentRows(item) {
    if (!item?.id) return [];
    return reminderDepartments
      .filter((row) => row.reminder_id === item.id)
      .map((row) => {
        const department = departments.find((dep) => dep.id === row.reparto_id);
        return department ? { ...department, reminder_reparto_id: row.id, completato: Boolean(row.completato), completato_at: row.completato_at, completato_da: row.completato_da } : null;
      })
      .filter(Boolean);
  }

  function canCompleteReminderDepartment(departmentId) {
    if (adminMode || canWriteAgenda) return true;
    return currentUserDepartmentIds().includes(departmentId);
  }

  const filteredProductsForReminder = useMemo(() => {
    const text = productQuery.trim().toLowerCase();
    if (!text) return products;
    return products.filter((product) => `${product.nome || ""} ${product.codice || ""}`.toLowerCase().includes(text));
  }, [products, productQuery]);

  function toggleFormArray(field, value) {
    setForm((current) => {
      const list = safeArray(current[field]);
      const nextList = list.includes(value) ? list.filter((id) => id !== value) : [...list, value];
      return { ...current, [field]: nextList };
    });
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  async function saveReminderAssociations(reminderId, productIds, departmentIds) {
    await Promise.all([
      supabase.from("agenda_reminder_prodotti").delete().eq("reminder_id", reminderId),
      supabase.from("agenda_reminder_reparti").delete().eq("reminder_id", reminderId),
    ]);

    const productRows = safeArray(productIds).filter(Boolean).map((prodotto_id) => {
      const product = products.find((item) => item.id === prodotto_id);
      return { reminder_id: reminderId, prodotto_id, prodotto_nome: product?.nome || null };
    });
    const departmentRows = safeArray(departmentIds).filter(Boolean).map((reparto_id) => ({ reminder_id: reminderId, reparto_id, completato: false }));

    if (productRows.length) {
      const { error } = await supabase.from("agenda_reminder_prodotti").insert(productRows);
      if (error) throw error;
    }
    if (departmentRows.length) {
      const { error } = await supabase.from("agenda_reminder_reparti").insert(departmentRows);
      if (error) throw error;
    }
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
        const productName = getReminderProductNames(item);
        const departmentName = getReminderDepartmentNames(item);
        const projectTitle = projects.find((p) => p.id === item.progetto_id)?.titolo || "";
        return `${item.titolo || ""} ${item.descrizione || ""} ${productName} ${departmentName} ${projectTitle} ${userName(item.utente_id)}`
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

  function currentUserDepartmentIds() {
    return profile?.reparto_ids || [profile?.reparto_id].filter(Boolean);
  }

  function isReminderForOwnDepartment(item) {
    if (!item?.id) return false;
    const ids = currentUserDepartmentIds();
    if (!ids.length) return false;
    return reminderDepartments
      .filter((row) => row.reminder_id === item.id && row.reparto_id)
      .some((row) => ids.includes(row.reparto_id));
  }

  function canEditReminder(item) {
    if (!item?.id) return canWriteAgenda;
    return adminMode || item.utente_id === profile?.id || isReminderForOwnDepartment(item);
  }

  function openNew() {
    if (!canWriteAgenda) return alert("Non hai i permessi per creare reminder.");
    setForm({ ...defaultForm, deadline: todayIso(), prodotti: [], reparto_ids: [] });
    setProductQuery("");
    setSelected(null);
    setComments([]);
    setAttachments([]);
    setComment("");
    setProductQuery("");
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
      prodotti: getReminderProductIds(item.id, item.prodotto_id),
      reparto_ids: getReminderDepartmentIds(item.id),
      stato: item.stato || "Aperto",
    });
    setComment("");
    setProductQuery("");
    setFormOpen(true);
  }

  async function saveReminder(e) {
    e.preventDefault();
    if (!selected?.id && !canWriteAgenda) return alert("Non hai i permessi per creare reminder.");
    if (selected?.id && !canEditReminder(selected)) return alert("Non hai i permessi per modificare questo reminder.");
    if (!form.titolo.trim()) return alert("Inserisci il titolo.");

    setSaving(true);
    const payload = {
      utente_id: selected?.utente_id || profile.id,
      titolo: form.titolo.trim(),
      descrizione: form.descrizione.trim() || null,
      deadline: form.deadline || null,
      prodotto_id: safeArray(form.prodotti)[0] || form.prodotto_id || null,
      progetto_id: form.progetto_id || null,
      stato: form.stato || "Aperto",
      updated_at: new Date().toISOString(),
    };

    const request = selected?.id
      ? supabase.from("agenda_reminder").update(payload).eq("id", selected.id).select().single()
      : supabase.from("agenda_reminder").insert(payload).select().single();

    const { data, error } = await request;
    if (error) {
      setSaving(false);
      return alert(`Errore salvataggio: ${error.message}`);
    }

    try {
      await saveReminderAssociations(data.id, form.prodotti, form.reparto_ids);
    } catch (associationError) {
      setSaving(false);
      return alert(`Errore associazioni reminder: ${associationError.message}`);
    }

    setSaving(false);
    await loadData();
    if (data?.id) {
      setSelected(data);
      await loadDetail(data.id);
    }
  }

  async function deleteReminder(item) {
    if (!canEditReminder(item)) return alert("Non hai i permessi per eliminare questo reminder.");
    if (!confirm("Eliminare questo reminder?\n\nVerranno eliminati anche commenti, allegati e file collegati.")) return;

    const { data: files, error: filesError } = await supabase
      .from("agenda_allegati")
      .select("file_url")
      .eq("reminder_id", item.id);

    if (filesError) return alert(filesError.message);

    const paths = (files || [])
      .map((file) => {
        try {
          if (!file.file_url) return null;
          const url = new URL(file.file_url);
          const marker = "/object/public/allegati/";
          const index = url.pathname.indexOf(marker);
          if (index === -1) return null;
          return decodeURIComponent(url.pathname.slice(index + marker.length));
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage.from("allegati").remove(paths);
      if (storageError) return alert(`Errore eliminazione file: ${storageError.message}`);
    }

    await supabase.from("agenda_commenti").delete().eq("reminder_id", item.id);
    await supabase.from("agenda_allegati").delete().eq("reminder_id", item.id);
    await supabase.from("agenda_reminder_prodotti").delete().eq("reminder_id", item.id);
    await supabase.from("agenda_reminder_reparti").delete().eq("reminder_id", item.id);

    const { error } = await supabase.from("agenda_reminder").delete().eq("id", item.id);
    if (error) return alert(error.message);

    setSelected(null);
    setFormOpen(false);
    await loadData();
  }

  async function completeReminder(item) {
    if (!canEditReminder(item)) return alert("Non hai i permessi per completare questo reminder.");

    const departmentsForReminder = getReminderDepartmentRows(item);
    if (departmentsForReminder.length > 0) {
      return alert("Questo reminder è condiviso con più reparti. Completa il reminder reparto per reparto dalla scheda di dettaglio o dalla modifica reminder.");
    }

    const { error } = await supabase
      .from("agenda_reminder")
      .update({ completato: true, stato: "Completato", completato_il: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", item.id);
    if (error) return alert(error.message);
    await loadData();
    const updated = { ...item, completato: true, stato: "Completato" };
    if (selected?.id === item.id) setSelected(updated);
  }

  async function completeReminderDepartment(item, department) {
    if (!item?.id || !department?.id) return;
    if (!canCompleteReminderDepartment(department.id)) return alert("Non hai i permessi per completare questo reparto.");

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("agenda_reminder_reparti")
      .update({ completato: true, completato_at: now, completato_da: profile?.id || null })
      .eq("reminder_id", item.id)
      .eq("reparto_id", department.id);
    if (error) return alert(error.message);

    const { data: rows, error: rowsError } = await supabase
      .from("agenda_reminder_reparti")
      .select("reparto_id,completato")
      .eq("reminder_id", item.id);
    if (rowsError) return alert(rowsError.message);

    const allCompleted = (rows || []).length > 0 && (rows || []).every((row) => Boolean(row.completato));
    const payload = allCompleted
      ? { completato: true, stato: "Completato", completato_il: now, updated_at: now }
      : { completato: false, stato: "In lavorazione", completato_il: null, updated_at: now };

    const { error: reminderError } = await supabase.from("agenda_reminder").update(payload).eq("id", item.id);
    if (reminderError) return alert(reminderError.message);

    await loadData();
    await loadDetail(item.id);
    if (selected?.id === item.id) setSelected({ ...item, ...payload });
  }

  async function reopenReminderDepartment(item, department) {
    if (!item?.id || !department?.id) return;
    if (!canCompleteReminderDepartment(department.id)) return alert("Non hai i permessi per riaprire questo reparto.");

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("agenda_reminder_reparti")
      .update({ completato: false, completato_at: null, completato_da: null })
      .eq("reminder_id", item.id)
      .eq("reparto_id", department.id);
    if (error) return alert(error.message);

    const { error: reminderError } = await supabase
      .from("agenda_reminder")
      .update({ completato: false, stato: "In lavorazione", completato_il: null, updated_at: now })
      .eq("id", item.id);
    if (reminderError) return alert(reminderError.message);

    await loadData();
    await loadDetail(item.id);
    if (selected?.id === item.id) setSelected({ ...item, completato: false, stato: "In lavorazione", completato_il: null });
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
                        <button className="v4-list-main" onClick={() => setSelected(item)}>
                          <strong>{item.titolo}</strong>
                          <span>{item.descrizione || "Nessuna descrizione"}</span>
                          <small>
                            {adminMode ? `${userName(item.utente_id)} · ` : ""}
                            {getReminderProductNames(item)}
                            {getReminderDepartmentNames(item) ? ` · ${getReminderDepartmentNames(item)}` : ""}
                            {projects.find((p) => p.id === item.progetto_id)?.titolo ? ` · ${projects.find((p) => p.id === item.progetto_id)?.titolo}` : ""}
                          </small>
                        </button>
                        <span className={`status-pill ${statusClass(item)}`}>{statusOf(item)}</span>
                        {!isDone(item) && canEditReminder(item) && getReminderDepartmentRows(item).length === 0 && (
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
            {selected && (
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span className={`status-pill ${statusClass(selected)}`}>{statusOf(selected)}</span>
                {canEditReminder(selected) && (
                  <button type="button" className="icon-action" onClick={() => openEdit(selected)}>Modifica</button>
                )}
              </div>
            )}
          </div>
          {!selected ? (
            <p className="empty-text">Seleziona un reminder per vedere commenti e allegati.</p>
          ) : (
            <>
              <p className="detail-description">{selected.descrizione || "Nessuna descrizione."}</p>
              <div className="mini-meta"><span><Clock size={15} /> {formatDate(selected.deadline)}</span></div>
              {getReminderDepartmentRows(selected).length > 0 && (
                <div className="checkbox-group">
                  <strong>Completamento per reparto</strong>
                  {getReminderDepartmentRows(selected).map((department) => (
                    <div key={department.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", padding: "8px 0" }}>
                      <span>{department.completato ? "✓" : "○"} {department.nome}{department.completato_at ? ` · ${new Date(department.completato_at).toLocaleString("it-IT")}` : ""}</span>
                      {department.completato ? (
                        <button type="button" className="reopen-phase-btn" onClick={() => reopenReminderDepartment(selected, department)}><Clock size={15} /> Riapri {department.nome}</button>
                      ) : (
                        <button type="button" className="complete-phase-btn" onClick={() => completeReminderDepartment(selected, department)} disabled={!canCompleteReminderDepartment(department.id)}><CheckCircle2 size={15} /> Completa {department.nome}</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
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
            <label>Progetto<select value={form.progetto_id} onChange={(e) => setForm({ ...form, progetto_id: e.target.value })}><option value="">Nessuno</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.titolo}</option>)}</select></label>

            <div className="checkbox-group scrollable-check-group">
              <strong>Condividi con reparti</strong>
              {departments.map((department) => (
                <label key={department.id}>
                  <input type="checkbox" checked={safeArray(form.reparto_ids).includes(department.id)} onChange={() => toggleFormArray("reparto_ids", department.id)} />
                  {department.nome}
                </label>
              ))}
            </div>

            <div className="checkbox-group scrollable-check-group">
              <strong>Prodotti associati</strong>
              <div className="task-search" style={{ margin: "8px 0" }}>
                <Search size={18} />
                <input placeholder="Ricerca rapida prodotto..." value={productQuery} onChange={(e) => setProductQuery(e.target.value)} />
              </div>
              {filteredProductsForReminder.length === 0 ? <p className="empty-text">Nessun prodotto trovato.</p> : filteredProductsForReminder.map((product) => (
                <label key={product.id}>
                  <input type="checkbox" checked={safeArray(form.prodotti).includes(product.id)} onChange={() => toggleFormArray("prodotti", product.id)} />
                  {product.nome}{product.codice ? ` · ${product.codice}` : ""}
                </label>
              ))}
            </div>

            {selected?.id && getReminderDepartmentRows(selected).length > 0 && (
              <div className="checkbox-group">
                <strong>Completamento per reparto</strong>
                {getReminderDepartmentRows(selected).map((department) => (
                  <div key={department.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", padding: "8px 0" }}>
                    <span>{department.completato ? "✓" : "○"} {department.nome}{department.completato_at ? ` · ${new Date(department.completato_at).toLocaleString("it-IT")}` : ""}</span>
                    {department.completato ? (
                      <button type="button" className="reopen-phase-btn" onClick={() => reopenReminderDepartment(selected, department)}><Clock size={15} /> Riapri {department.nome}</button>
                    ) : (
                      <button type="button" className="complete-phase-btn" onClick={() => completeReminderDepartment(selected, department)} disabled={!canCompleteReminderDepartment(department.id)}><CheckCircle2 size={15} /> Completa {department.nome}</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="dashboard-message-actions">
              {selected && !isDone(selected) && getReminderDepartmentRows(selected).length === 0 && <button type="button" className="secondary-action" onClick={() => completeReminder(selected)}><CheckCircle2 size={18} /> Evadi</button>}
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

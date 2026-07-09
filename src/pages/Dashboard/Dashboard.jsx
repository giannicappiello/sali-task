import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ListChecks,
  MessageCircle,
  Plus,
  Save,
  X,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import PhaseChecklistModal from "../../components/PhaseChecklistModal";

const CLOSED_STATES = ["evaso", "evasa", "completato", "completata", "chiuso", "chiusa"];
const emptyPhaseForm = { titolo: "", descrizione: "", note: "", progetto_id: "", deadline: "", reparto_ids: [], prodotti: [], stato: "da_evadere" };
const emptyReminderForm = { titolo: "", descrizione: "", deadline: "", prodotto_id: "", progetto_id: "", stato: "Aperto" };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function formatDateForQuery(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replaceAll(" ", "_");
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isTaskDone(item) {
  return CLOSED_STATES.includes(normalize(item?.stato)) || Boolean(item?.completato_at);
}

function isReminderDone(item) {
  return Boolean(item?.completato) || normalize(item?.stato) === "completato";
}

function isOverdue(item) {
  const deadline = dateOnly(item?.deadline);
  if (!deadline) return false;
  const done = item.tipo === "reminder" ? isReminderDone(item) : isTaskDone(item);
  return !done && deadline < todayIso();
}

function formatMonth(date) {
  return date.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
}

function formatDateHuman(dateKey) {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString("it-IT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function statusLabel(item) {
  if (item.tipo === "reminder") {
    if (isReminderDone(item)) return "Evaso";
    if (isOverdue(item)) return "Scaduto";
    return "Pianificato";
  }
  if (isTaskDone(item)) return "Completata";
  if (isOverdue(item)) return "Scaduta";
  return "Pianificata";
}


function DashboardColorLegend() {
  return (
    <div className="panel" style={{ padding: "12px 16px", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <strong style={{ marginRight: "4px" }}>Legenda colori</strong>
        <span className="dashboard-day-line success">Pianificate</span>
        <span className="dashboard-day-line danger">Scadute</span>
        <span className="status-pill done">Completate / evasi</span>
      </div>
    </div>
  );
}

function Dashboard() {
  const { profile, userDepartmentIds = [] } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [projects, setProjects] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [products, setProducts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [templateDepartments, setTemplateDepartments] = useState([]);
  const [phaseDepartments, setPhaseDepartments] = useState([]);
  const [phaseProducts, setPhaseProducts] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [activityFilter, setActivityFilter] = useState(null);
  const [messagesCount, setMessagesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedPhase, setSelectedPhase] = useState(null);
  const [phaseForm, setPhaseForm] = useState(emptyPhaseForm);
  const [phaseModalOpen, setPhaseModalOpen] = useState(false);
  const [selectedReminder, setSelectedReminder] = useState(null);
  const [reminderForm, setReminderForm] = useState(emptyReminderForm);
  const [reminderModalOpen, setReminderModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile?.id) loadData();
  }, [profile?.id, profile?.reparto_id, userDepartmentIds.join(",")]);

  async function loadData() {
    setLoading(true);

    const departmentIds = userDepartmentIds.length ? userDepartmentIds : [profile?.reparto_id].filter(Boolean);

    const [phasesRes, phaseDepartmentsRes, phaseProductsRes, remindersRes, messageParticipantsRes, projectsRes, departmentsRes, productsRes, templatesRes, templateDepartmentsRes] = await Promise.all([
      supabase
        .from("v4_fasi_progetto")
        .select("id,titolo,descrizione,note,stato,deadline,reparto_id,progetto_id,completato_at,v4_progetti(id,titolo),reparti(id,nome)")
        .order("deadline", { ascending: true, nullsFirst: false }),
      supabase.from("v4_fase_reparti").select("id,fase_id,reparto_id,completato,completato_at,completato_da,reparti(id,nome)"),
      supabase.from("v4_fase_prodotti").select("id,fase_id,prodotto_id,prodotto_nome"),
      supabase
        .from("agenda_reminder")
        .select("id,titolo,descrizione,stato,deadline,completato,utente_id,prodotto_id,progetto_id,updated_at")
        .eq("utente_id", profile.id)
        .order("deadline", { ascending: true, nullsFirst: false }),
      supabase
        .from("chat_partecipanti")
        .select("id,ultimo_letto_at,conversazione_id,chat_conversazioni(updated_at)")
        .eq("utente_id", profile.id),
      supabase.from("v4_progetti").select("id,titolo").order("created_at", { ascending: false }).limit(500),
      supabase.from("reparti").select("id,nome,attivo").order("nome"),
      supabase.from("prodotti").select("id,nome,codice").order("nome").limit(5000),
      supabase.from("checklist_template").select("id,titolo,reparto_id,ordine,attivo,reparti(id,nome)").eq("attivo", true).order("ordine", { ascending: true }),
      supabase.from("checklist_template_reparti").select("id,template_id,reparto_id"),
    ]);

    if (phasesRes.error) console.error("Dashboard fasi:", phasesRes.error.message);
    if (phaseDepartmentsRes.error) console.error("Dashboard reparti fase:", phaseDepartmentsRes.error.message);
    if (phaseProductsRes.error) console.error("Dashboard prodotti fase:", phaseProductsRes.error.message);
    if (remindersRes.error) console.error("Dashboard reminder:", remindersRes.error.message);
    if (messageParticipantsRes.error) console.error("Dashboard messaggi:", messageParticipantsRes.error.message);

    const allPhaseDepartments = phaseDepartmentsRes.data || [];
    const visibleTasks = (phasesRes.data || []).filter((phase) => {
      if (!departmentIds.length) return true;
      const phaseDeps = allPhaseDepartments
        .filter((row) => row.fase_id === phase.id && row.reparto_id)
        .map((row) => row.reparto_id);
      if (phaseDeps.length) return phaseDeps.some((id) => departmentIds.includes(id));
      if (!phase.reparto_id) return true;
      return departmentIds.includes(phase.reparto_id);
    });

    const unreadMessages = (messageParticipantsRes.data || []).filter((row) => {
      const updatedAt = row.chat_conversazioni?.updated_at;
      if (!updatedAt) return false;
      if (!row.ultimo_letto_at) return true;
      return new Date(updatedAt).getTime() > new Date(row.ultimo_letto_at).getTime();
    }).length;

    setTasks(visibleTasks.map((item) => ({ ...item, tipo: "task" })));
    setReminders((remindersRes.data || []).map((item) => ({ ...item, tipo: "reminder" })));
    setPhaseDepartments(allPhaseDepartments);
    setPhaseProducts(phaseProductsRes.data || []);
    setProjects(projectsRes.data || []);
    setDepartments((departmentsRes.data || []).filter((item) => item.attivo !== false));
    setProducts(productsRes.data || []);
    setTemplates(templatesRes.data || []);
    setTemplateDepartments(templateDepartmentsRes.data || []);
    setMessagesCount(unreadMessages);
    setLoading(false);
  }

  const activities = useMemo(() => [...tasks, ...reminders], [tasks, reminders]);

  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - startOffset);

    return Array.from({ length: 42 }).map((_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      const dateKey = formatDateForQuery(day);
      const dayItems = activities.filter((item) => dateOnly(item.deadline) === dateKey);
      const dayTasks = dayItems.filter((item) => item.tipo === "task");
      const dayReminders = dayItems.filter((item) => item.tipo === "reminder");
      const plannedTasks = dayTasks.filter((item) => !isTaskDone(item) && !isOverdue(item)).length;
      const overdueTasks = dayTasks.filter(isOverdue).length;
      const plannedReminders = dayReminders.filter((item) => !isReminderDone(item) && !isOverdue(item)).length;
      const overdueReminders = dayReminders.filter(isOverdue).length;

      return {
        date: day,
        dateKey,
        inMonth: day.getMonth() === month,
        isToday: dateKey === todayIso(),
        isSelected: dateKey === selectedDate,
        items: dayItems,
        plannedTasks,
        overdueTasks,
        plannedReminders,
        overdueReminders,
        hasOverdue: overdueTasks + overdueReminders > 0,
      };
    });
  }, [activities, currentMonth, selectedDate]);

  const monthItems = useMemo(() => {
    const month = currentMonth.getMonth();
    const year = currentMonth.getFullYear();
    return activities.filter((item) => {
      const deadline = dateOnly(item.deadline);
      if (!deadline) return false;
      const d = new Date(`${deadline}T00:00:00`);
      return d.getMonth() === month && d.getFullYear() === year;
    });
  }, [activities, currentMonth]);

  function filterActivities(items, filter) {
    if (filter === "plannedTasks") return items.filter((item) => item.tipo === "task" && !isTaskDone(item) && !isOverdue(item));
    if (filter === "overdueTasks") return items.filter((item) => item.tipo === "task" && isOverdue(item));
    if (filter === "plannedReminders") return items.filter((item) => item.tipo === "reminder" && !isReminderDone(item) && !isOverdue(item));
    if (filter === "overdueReminders") return items.filter((item) => item.tipo === "reminder" && isOverdue(item));
    return items;
  }

  const selectedItems = useMemo(() => {
    if (activityFilter) return filterActivities(monthItems, activityFilter);
    return activities.filter((item) => dateOnly(item.deadline) === selectedDate);
  }, [activities, selectedDate, activityFilter, monthItems]);

  const monthStats = useMemo(() => {
    const monthTasks = monthItems.filter((item) => item.tipo === "task");
    const monthReminders = monthItems.filter((item) => item.tipo === "reminder");
    return {
      plannedTasks: monthTasks.filter((item) => !isTaskDone(item) && !isOverdue(item)).length,
      overdueTasks: monthTasks.filter(isOverdue).length,
      plannedReminders: monthReminders.filter((item) => !isReminderDone(item) && !isOverdue(item)).length,
      overdueReminders: monthReminders.filter(isOverdue).length,
    };
  }, [monthItems]);

  const sidePanelTitle = activityFilter
    ? {
        plannedTasks: "Task/fasi pianificate",
        overdueTasks: "Task/fasi scadute",
        plannedReminders: "Reminder pianificati",
        overdueReminders: "Reminder scaduti",
      }[activityFilter]
    : formatDateHuman(selectedDate);

  function changeMonth(direction) {
    setCurrentMonth((current) => {
      const next = new Date(current);
      next.setMonth(current.getMonth() + direction);
      return next;
    });
  }

  function goToday() {
    const today = new Date();
    setCurrentMonth(today);
    setSelectedDate(todayIso());
    setActivityFilter(null);
  }

  function getPhaseDepartmentIds(phaseId) {
    return phaseDepartments.filter((row) => row.fase_id === phaseId).map((row) => row.reparto_id).filter(Boolean);
  }

  function getPhaseProductIds(phaseId) {
    return phaseProducts.filter((row) => row.fase_id === phaseId).map((row) => row.prodotto_id).filter(Boolean);
  }

  function openNewPhase() {
    setSelectedPhase(null);
    setPhaseForm({ ...emptyPhaseForm, deadline: selectedDate || todayIso(), reparto_ids: userDepartmentIds.length ? [userDepartmentIds[0]] : [] });
    setPhaseModalOpen(true);
  }

  function openPhaseEdit(item) {
    setSelectedPhase(item);
    setPhaseForm({
      titolo: item.titolo || "",
      descrizione: item.descrizione || "",
      note: item.note || "",
      progetto_id: item.progetto_id || "",
      deadline: dateOnly(item.deadline) || "",
      reparto_ids: getPhaseDepartmentIds(item.id).length ? getPhaseDepartmentIds(item.id) : [item.reparto_id].filter(Boolean),
      prodotti: getPhaseProductIds(item.id),
      stato: item.stato || "da_evadere",
    });
    setPhaseModalOpen(true);
  }

  function openNewReminder() {
    setSelectedReminder(null);
    setReminderForm({ ...emptyReminderForm, deadline: selectedDate || todayIso() });
    setReminderModalOpen(true);
  }

  function openReminderEdit(item) {
    setSelectedReminder(item);
    setReminderForm({
      titolo: item.titolo || "",
      descrizione: item.descrizione || "",
      deadline: dateOnly(item.deadline) || "",
      prodotto_id: item.prodotto_id || "",
      progetto_id: item.progetto_id || "",
      stato: item.stato || "Aperto",
    });
    setReminderModalOpen(true);
  }

  function openActivity(item) {
    if (item.tipo === "reminder") openReminderEdit(item);
    else openPhaseEdit(item);
  }

  function togglePhaseDepartment(departmentId) {
    setPhaseForm((current) => {
      const currentIds = safeArray(current.reparto_ids);
      const nextIds = currentIds.includes(departmentId) ? currentIds.filter((id) => id !== departmentId) : [...currentIds, departmentId];
      return { ...current, reparto_ids: nextIds };
    });
  }

  function togglePhaseProduct(productId) {
    setPhaseForm((current) => {
      const currentIds = safeArray(current.prodotti);
      const nextIds = currentIds.includes(productId) ? currentIds.filter((id) => id !== productId) : [...currentIds, productId];
      return { ...current, prodotti: nextIds };
    });
  }

  function canCompleteDepartment(departmentId) {
    const ids = userDepartmentIds.length ? userDepartmentIds : [profile?.reparto_id].filter(Boolean);
    if (!departmentId) return true;
    return ids.includes(departmentId);
  }

  async function savePhaseDepartments(phaseId, departmentIds) {
    await supabase.from("v4_fase_reparti").delete().eq("fase_id", phaseId);
    const rows = safeArray(departmentIds).map((departmentId) => ({ fase_id: phaseId, reparto_id: departmentId, completato: false }));
    if (rows.length) await supabase.from("v4_fase_reparti").insert(rows);
  }

  async function savePhaseProducts(phaseId, productIds) {
    await supabase.from("v4_fase_prodotti").delete().eq("fase_id", phaseId);
    const rows = safeArray(productIds).map((productId) => {
      const product = products.find((item) => item.id === productId);
      return { fase_id: phaseId, prodotto_id: productId, prodotto_nome: product?.nome || null };
    });
    if (rows.length) await supabase.from("v4_fase_prodotti").insert(rows);
  }

  async function savePhase(e) {
    e.preventDefault();
    if (!phaseForm.titolo.trim()) return alert("Inserisci il titolo della task/fase.");
    setSaving(true);
    const payload = {
      progetto_id: phaseForm.progetto_id || null,
      titolo: phaseForm.titolo.trim(),
      descrizione: phaseForm.descrizione.trim() || null,
      note: phaseForm.note.trim() || null,
      priorita: null,
      deadline: phaseForm.deadline || null,
      reparto_id: safeArray(phaseForm.reparto_ids)[0] || null,
      stato: phaseForm.stato || "da_evadere",
      modificato_da: profile?.id || null,
      updated_at: new Date().toISOString(),
    };
    if (!selectedPhase?.id) payload.creato_da = profile?.id || null;

    const request = selectedPhase?.id
      ? supabase.from("v4_fasi_progetto").update(payload).eq("id", selectedPhase.id).select().single()
      : supabase.from("v4_fasi_progetto").insert(payload).select().single();
    const { data, error } = await request;
    if (error) {
      setSaving(false);
      return alert(error.message);
    }
    const phaseId = data?.id || selectedPhase?.id;
    await savePhaseDepartments(phaseId, phaseForm.reparto_ids);
    await savePhaseProducts(phaseId, phaseForm.prodotti);
    setSaving(false);
    setPhaseModalOpen(false);
    await loadData();
  }

  async function saveReminder(e) {
    e.preventDefault();
    if (!reminderForm.titolo.trim()) return alert("Inserisci il titolo del reminder.");
    setSaving(true);
    const payload = {
      utente_id: selectedReminder?.utente_id || profile.id,
      titolo: reminderForm.titolo.trim(),
      descrizione: reminderForm.descrizione.trim() || null,
      deadline: reminderForm.deadline || null,
      prodotto_id: reminderForm.prodotto_id || null,
      progetto_id: reminderForm.progetto_id || null,
      stato: reminderForm.stato || "Aperto",
      updated_at: new Date().toISOString(),
    };
    const request = selectedReminder?.id
      ? supabase.from("agenda_reminder").update(payload).eq("id", selectedReminder.id).select().single()
      : supabase.from("agenda_reminder").insert(payload).select().single();
    const { error } = await request;
    setSaving(false);
    if (error) return alert(error.message);
    setReminderModalOpen(false);
    await loadData();
  }

  async function completeReminder(item) {
    const { error } = await supabase.from("agenda_reminder").update({ completato: true, stato: "Completato", completato_il: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", item.id);
    if (error) return alert(error.message);
    await loadData();
  }

  async function completePhase(item) {
    const { error } = await supabase.from("v4_fasi_progetto").update({ stato: "evaso", completato_at: new Date().toISOString(), updated_at: new Date().toISOString(), modificato_da: profile?.id || null }).eq("id", item.id);
    if (error) return alert(error.message);
    await loadData();
  }

  return (
    <div className="calendar-page dashboard-activities-page">
      <div className="page-title-row">
        <div>
          <h1>Le mie attività</h1>
          <p>Task/fasi del tuo reparto e reminder personali.</p>
        </div>
        <div className="dashboard-quick-actions">
          <button className="primary-action" onClick={openNewPhase}><Plus size={18} /> Nuova task/fase</button>
          <button className="secondary-action" onClick={openNewReminder}><Plus size={18} /> Nuovo reminder</button>
          <button className="secondary-action" onClick={goToday}>Oggi</button>
        </div>
      </div>

      <div className="calendar-kpi-grid dashboard-activity-kpis">
        <button type="button" className={`calendar-kpi success ${activityFilter === "plannedTasks" ? "active" : ""}`} onClick={() => setActivityFilter("plannedTasks")}>
          <ListChecks size={22} />
          <div><strong>{loading ? "..." : monthStats.plannedTasks}</strong><span>Task/fasi pianificate</span></div>
        </button>
        <button type="button" className={`calendar-kpi danger ${activityFilter === "overdueTasks" ? "active" : ""}`} onClick={() => setActivityFilter("overdueTasks")}>
          <AlertCircle size={22} />
          <div><strong>{loading ? "..." : monthStats.overdueTasks}</strong><span>Task/fasi scadute</span></div>
        </button>
        <button type="button" className={`calendar-kpi success ${activityFilter === "plannedReminders" ? "active" : ""}`} onClick={() => setActivityFilter("plannedReminders")}>
          <CalendarDays size={22} />
          <div><strong>{loading ? "..." : monthStats.plannedReminders}</strong><span>Reminder pianificati</span></div>
        </button>
        <button type="button" className={`calendar-kpi danger ${activityFilter === "overdueReminders" ? "active" : ""}`} onClick={() => setActivityFilter("overdueReminders")}>
          <Clock size={22} />
          <div><strong>{loading ? "..." : monthStats.overdueReminders}</strong><span>Reminder scaduti</span></div>
        </button>
      </div>

      <DashboardColorLegend />

      <div className="calendar-layout-grid">
        <div className="panel calendar-main-panel">
          <div className="calendar-main-header">
            <button type="button" onClick={() => changeMonth(-1)}><ChevronLeft size={20} /></button>
            <h3>{formatMonth(currentMonth)}</h3>
            <button type="button" onClick={() => changeMonth(1)}><ChevronRight size={20} /></button>
          </div>

          {loading ? <p className="table-message">Caricamento attività...</p> : (
            <div className="full-calendar">
              <div className="full-calendar-weekdays">
                <span>Lunedì</span><span>Martedì</span><span>Mercoledì</span><span>Giovedì</span><span>Venerdì</span><span>Sabato</span><span>Domenica</span>
              </div>
              <div className="full-calendar-days">
                {calendarDays.map((day) => (
                  <button
                    key={day.dateKey}
                    type="button"
                    className={`full-calendar-day ${day.inMonth ? "" : "muted"} ${day.isToday ? "today" : ""} ${day.isSelected ? "selected" : ""} ${day.items.length ? "has-task" : ""} ${day.hasOverdue ? "has-overdue" : ""}`}
                    onClick={() => { setSelectedDate(day.dateKey); setActivityFilter(null); }}
                  >
                    <span className="day-number">{day.date.getDate()}</span>
                    {day.items.length > 0 && (
                      <div className="dashboard-day-counts">
                        {day.plannedTasks > 0 && <span className="dashboard-day-line success">Task {day.plannedTasks}</span>}
                        {day.overdueTasks > 0 && <span className="dashboard-day-line danger">Task scad. {day.overdueTasks}</span>}
                        {day.plannedReminders > 0 && <span className="dashboard-day-line success">Rem. {day.plannedReminders}</span>}
                        {day.overdueReminders > 0 && <span className="dashboard-day-line danger">Rem. scad. {day.overdueReminders}</span>}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="panel calendar-side-panel">
          <div className="panel-header">
            <div>
              <h3>{sidePanelTitle}</h3>
              <p>{activityFilter ? `${selectedItems.length} attività nel mese` : `${selectedItems.length} attività nel giorno`}</p>
            </div>
          </div>

          {selectedItems.length === 0 ? (
            <div className="calendar-empty-day"><CalendarDays size={34} /><h4>Nessuna attività</h4><p>Non ci sono attività per questo filtro.</p></div>
          ) : activityFilter ? (
            <div className="dashboard-activity-list"><ActivityGroup title={sidePanelTitle} danger={activityFilter.includes("overdue")} items={selectedItems} onOpen={openActivity} /></div>
          ) : (
            <div className="dashboard-activity-list">
              <ActivityGroup title="Task/fasi pianificate" items={selectedItems.filter((item) => item.tipo === "task" && !isTaskDone(item) && !isOverdue(item))} onOpen={openActivity} />
              <ActivityGroup title="Task/fasi scadute" danger items={selectedItems.filter((item) => item.tipo === "task" && isOverdue(item))} onOpen={openActivity} />
              <ActivityGroup title="Reminder pianificati" items={selectedItems.filter((item) => item.tipo === "reminder" && !isReminderDone(item) && !isOverdue(item))} onOpen={openActivity} />
              <ActivityGroup title="Reminder scaduti" danger items={selectedItems.filter((item) => item.tipo === "reminder" && isOverdue(item))} onOpen={openActivity} />
              <ActivityGroup title="Completate / evasi" done items={selectedItems.filter((item) => item.tipo === "task" ? isTaskDone(item) : isReminderDone(item))} onOpen={openActivity} />
            </div>
          )}
        </div>
      </div>

      <div className="panel dashboard-messages-panel">
        <div className="panel-header">
          <div><h3>Messaggistica</h3><p>{messagesCount} nuovi messaggi in arrivo</p></div>
          <MessageCircle size={24} />
        </div>
        <div className="dashboard-message-actions">
          <button className="secondary-action" onClick={() => window.location.assign("/messages")}>Apri messaggi</button>
          <button className="primary-action" onClick={() => window.location.assign("/messages?new=1")}><Plus size={18} /> Crea nuovo messaggio</button>
        </div>
      </div>

      <PhaseChecklistModal
        open={phaseModalOpen}
        phase={selectedPhase}
        initialDate={selectedDate || todayIso()}
        projects={projects}
        departments={departments}
        products={products}
        phaseDepartments={phaseDepartments}
        phaseProducts={phaseProducts}
        templates={templates}
        templateDepartments={templateDepartments}
        canManage={true}
        canCompleteDepartment={canCompleteDepartment}
        onClose={() => setPhaseModalOpen(false)}
        onSaved={loadData}
      />

      {reminderModalOpen && (
        <div className="modal-backdrop">
          <form className="modal-card v4-modal" onSubmit={saveReminder}>
            <div className="modal-header"><h2>{selectedReminder ? "Modifica reminder" : "Nuovo reminder"}</h2><button type="button" onClick={() => setReminderModalOpen(false)}><X size={20} /></button></div>
            <label>Titolo<input value={reminderForm.titolo} onChange={(e) => setReminderForm({ ...reminderForm, titolo: e.target.value })} /></label>
            <label>Descrizione<textarea rows="4" value={reminderForm.descrizione} onChange={(e) => setReminderForm({ ...reminderForm, descrizione: e.target.value })} /></label>
            <div className="form-grid-2">
              <label>Deadline<input type="date" value={reminderForm.deadline} onChange={(e) => setReminderForm({ ...reminderForm, deadline: e.target.value })} /></label>
              <label>Stato<select value={reminderForm.stato} onChange={(e) => setReminderForm({ ...reminderForm, stato: e.target.value })}><option value="Aperto">Aperto</option><option value="Completato">Completato</option></select></label>
            </div>
            <div className="form-grid-2">
              <label>Prodotto<select value={reminderForm.prodotto_id} onChange={(e) => setReminderForm({ ...reminderForm, prodotto_id: e.target.value })}><option value="">Nessuno</option>{products.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
              <label>Progetto<select value={reminderForm.progetto_id} onChange={(e) => setReminderForm({ ...reminderForm, progetto_id: e.target.value })}><option value="">Nessuno</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.titolo}</option>)}</select></label>
            </div>
            <div className="dashboard-message-actions">
              {selectedReminder && !isReminderDone(selectedReminder) && <button type="button" className="secondary-action" onClick={() => completeReminder(selectedReminder)}><CheckCircle2 size={18} /> Evadi</button>}
              <button className="primary-action" disabled={saving}><Save size={18} /> {saving ? "Salvataggio..." : "Salva reminder"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function ActivityGroup({ title, items, danger = false, done = false, onOpen }) {
  if (!items.length) return null;
  return (
    <div className="dashboard-activity-group">
      <h4 className={danger ? "danger" : done ? "done" : "success"}>{title}</h4>
      {items.map((item) => (
        <button key={`${item.tipo}-${item.id}`} className={`calendar-task-card ${danger ? "overdue" : ""}`} onClick={() => onOpen(item)}>
          <strong>{item.titolo}</strong>
          <span>{item.tipo === "reminder" ? "Reminder personale" : item.v4_progetti?.titolo || "Senza progetto"}</span>
          <small>{statusLabel(item)} · {item.tipo === "task" ? item.reparti?.nome || "Reparto" : "Personale"}</small>
        </button>
      ))}
    </div>
  );
}

export default Dashboard;

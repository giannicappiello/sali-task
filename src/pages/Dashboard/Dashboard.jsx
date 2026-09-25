import { formatDisplayDate } from '../../lib/displayLocale.js';
import PreparationActions from './PreparationActions';
import { displayDate } from '../../lib/displayDate';
import { Modal as CostModal } from '../../features/production-costs/common';
import ProductSpecificationViewButton from '../Documentation/ProductSpecificationViewButton';
import PackagingSheetActions from './PackagingSheetActions';
import PackagingOperationalActions from './PackagingOperationalActions';
import { matchesActivitySearch } from "./activitySearch";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Plus,
  Save,
  Search,
  X,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import PhaseChecklistModal from "../../components/PhaseChecklistModal";
import InfoTooltip from "../../components/InfoTooltip";
import useProductionCalendar from './useProductionCalendar';
import { activityOnDay, activityInMonth } from './productionCalendar';
import DashboardActivityToolbar from "./DashboardActivityToolbar";
import { loadCrmCustomerDirectory, workspaceCustomerName } from "../../modules/crm/crmWorkspaceCustomers";

import "./dashboard-planning.css";
import { requestProgremesWorkspaceWindow } from "../ProgreMes/progremesWindow";

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

function formatDateHuman(dateKey) { return displayDate(dateKey); }

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
    <div className="dashboard-calendar-legend" style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
      <strong style={{ marginRight: "4px" }}>Legenda colori</strong>
      <span style={{ borderRadius: "999px", padding: "2px 8px", background: "#e0f2fe", color: "#1d4ed8", fontSize: "12px", fontWeight: 700 }}>Pianificate / aperte</span>
      <span style={{ borderRadius: "999px", padding: "2px 8px", background: "#fee2e2", color: "#b91c1c", fontSize: "12px", fontWeight: 700 }}>Scadute / bloccate</span>
      <span style={{ borderRadius: "999px", padding: "2px 8px", background: "#dcfce7", color: "#15803d", fontSize: "12px", fontWeight: 700 }}>Completate / evasi</span>
    </div>
  );
}

function Dashboard({ toolbarTarget = null }) {
  const { profile, userDepartmentIds = [], isAdmin, dataScope, canViewScopedData, hasScreenAccess, hasModuleAccess } = useAuth();
  const adminMode = Boolean(isAdmin?.() || dataScope?.mode === "tutti");
  const [tasks, setTasks] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [projects, setProjects] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [products, setProducts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [templateDepartments, setTemplateDepartments] = useState([]);
  const [phaseDepartments, setPhaseDepartments] = useState([]);
  const [phaseProducts, setPhaseProducts] = useState([]);
  const [reminderDepartments, setReminderDepartments] = useState([]);
  const [customerDirectory, setCustomerDirectory] = useState(() => new Map());
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const production = useProductionCalendar(profile?.id, currentMonth);
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [dayPopup, setDayPopup] = useState(null);
  const [activityPopup, setActivityPopup] = useState(null);
  const [activityFilter, setActivityFilter] = useState(null);
  const [query, setQuery] = useState("");
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
  }, [profile?.id, profile?.reparto_id, userDepartmentIds.join(","), dataScope?.mode, dataScope?.userIds?.join(","), dataScope?.departmentIds?.join(","), adminMode]);

  async function loadData() {
    setLoading(true);

    const [phasesRes, phaseDepartmentsRes, phaseProductsRes, remindersRes, reminderDepartmentsRes, messageParticipantsRes, projectsRes, projectDepartmentsRes, departmentsRes, productsRes, templatesRes, templateDepartmentsRes, customersRes] = await Promise.all([
      supabase
        .from("v4_fasi_progetto")
        .select("id,titolo,descrizione,note,stato,deadline,reparto_id,progetto_id,crm_customer_key,completato_at,creato_da,v4_progetti(id,titolo,crm_customer_key),reparti(id,nome)")
        .order("deadline", { ascending: true, nullsFirst: false }),
      supabase.from("v4_fase_reparti").select("id,fase_id,reparto_id,completato,completato_at,completato_da,reparti(id,nome)"),
      supabase.from("v4_fase_prodotti").select("id,fase_id,prodotto_id,prodotto_nome"),
      supabase
        .from("agenda_reminder")
        .select("id,titolo,descrizione,stato,deadline,completato,utente_id,prodotto_id,progetto_id,updated_at")
        .order("deadline", { ascending: true, nullsFirst: false }),
      supabase.from("agenda_reminder_reparti").select("id,reminder_id,reparto_id,completato,completato_at,completato_da"),
      supabase
        .from("chat_partecipanti")
        .select("id,ultimo_letto_at,conversazione_id,chat_conversazioni(updated_at)")
        .eq("utente_id", profile.id),
      supabase.from("v4_progetti").select("id,titolo,creato_da,crm_customer_key").order("created_at", { ascending: false }).limit(500),
      supabase.from("v4_progetto_reparti").select("progetto_id,reparto_id"),
      supabase.from("reparti").select("id,nome,attivo").order("nome"),
      supabase.from("prodotti").select("id,nome,codice").order("nome").limit(5000),
      supabase.from("checklist_template").select("id,titolo,reparto_id,ordine,attivo,reparti(id,nome)").eq("attivo", true).order("ordine", { ascending: true }),
      supabase.from("checklist_template_reparti").select("id,template_id,reparto_id"),
      loadCrmCustomerDirectory(supabase),
    ]);

    if (phasesRes.error) console.error("Dashboard fasi:", phasesRes.error.message);
    if (phaseDepartmentsRes.error) console.error("Dashboard reparti fase:", phaseDepartmentsRes.error.message);
    if (phaseProductsRes.error) console.error("Dashboard prodotti fase:", phaseProductsRes.error.message);
    if (remindersRes.error) console.error("Dashboard reminder:", remindersRes.error.message);
    if (reminderDepartmentsRes.error) console.error("Dashboard reparti reminder:", reminderDepartmentsRes.error.message);
    if (messageParticipantsRes.error) console.error("Dashboard messaggi:", messageParticipantsRes.error.message);
    if (projectsRes.error) console.error("Dashboard progetti:", projectsRes.error.message);
    if (projectDepartmentsRes.error) console.error("Dashboard reparti progetto:", projectDepartmentsRes.error.message);
    if (customersRes.error) console.error("Anagrafica clienti CRM dashboard:", customersRes.error.message);

    const allPhaseDepartments = phaseDepartmentsRes.data || [];
    const visibleTasks = (phasesRes.data || []).filter((phase) => {
      const phaseDeps = allPhaseDepartments
        .filter((row) => row.fase_id === phase.id && row.reparto_id)
        .map((row) => row.reparto_id);
      return canViewScopedData({
        ownerId: phase.creato_da,
        departmentIds: phaseDeps.length ? phaseDeps : [phase.reparto_id].filter(Boolean),
      });
    });

    const unreadMessages = (messageParticipantsRes.data || []).filter((row) => {
      const updatedAt = row.chat_conversazioni?.updated_at;
      if (!updatedAt) return false;
      if (!row.ultimo_letto_at) return true;
      return new Date(updatedAt).getTime() > new Date(row.ultimo_letto_at).getTime();
    }).length;

    const allReminderDepartments = reminderDepartmentsRes.data || [];
    const visibleReminders = (remindersRes.data || []).filter((reminder) => {
      const reminderDepartmentIds = allReminderDepartments
        .filter((row) => row.reminder_id === reminder.id && row.reparto_id)
        .map((row) => row.reparto_id);
      return canViewScopedData({ ownerId: reminder.utente_id, departmentIds: reminderDepartmentIds });
    });
    const visibleReminderIds = new Set(visibleReminders.map((reminder) => reminder.id));
    const allProjectDepartments = projectDepartmentsRes.data || [];
    const visibleProjects = (projectsRes.data || []).filter((project) => {
      const projectDepartmentIds = allProjectDepartments
        .filter((row) => row.progetto_id === project.id && row.reparto_id)
        .map((row) => row.reparto_id);
      return canViewScopedData({ ownerId: project.creato_da, departmentIds: projectDepartmentIds });
    });
    const visiblePhaseIds = new Set(visibleTasks.map((phase) => phase.id));
    const selectableDepartmentIds = new Set([...(userDepartmentIds || []), ...(dataScope?.departmentIds || [])]);

    setTasks(visibleTasks.map((item) => ({ ...item, tipo: "task" })));
    setReminders(visibleReminders.map((item) => ({ ...item, tipo: "reminder" })));
    setPhaseDepartments(allPhaseDepartments.filter((row) => visiblePhaseIds.has(row.fase_id)));
    setReminderDepartments(allReminderDepartments.filter((row) => visibleReminderIds.has(row.reminder_id)));
    setPhaseProducts((phaseProductsRes.data || []).filter((row) => visiblePhaseIds.has(row.fase_id)));
    setProjects(visibleProjects);
    setDepartments((departmentsRes.data || []).filter((item) => item.attivo !== false && (dataScope?.mode === "tutti" || selectableDepartmentIds.has(item.id))));
    setProducts(productsRes.data || []);
    setTemplates(templatesRes.data || []);
    setTemplateDepartments(templateDepartmentsRes.data || []);
    setCustomerDirectory(customersRes.directory);
    setMessagesCount(unreadMessages);
    setLoading(false);
  }

  const activities = useMemo(
    () => [...tasks.filter((item) => !isTaskDone(item)), ...reminders.filter((item) => !isReminderDone(item)), ...production.items],
    [tasks, reminders, production.items]
  );

  const filteredActivities = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return activities;

    return activities.filter((item) => {
      const projectTitle = item.v4_progetti?.titolo || projects.find((project) => project.id === item.progetto_id)?.titolo || "";
      const departmentName = item.reparti?.nome || "";
      const productName = products.find((product) => product.id === item.prodotto_id)?.nome || "";
      const project = item.v4_progetti || projects.find((candidate) => candidate.id === item.progetto_id);
      const customerName = workspaceCustomerName(customerDirectory, item.crm_customer_key || project?.crm_customer_key);
      const linkedProductIds = phaseProducts.filter(link => link.fase_id === item.id).map(link => link.prodotto_id);
      const linkedProducts = products.filter(product => linkedProductIds.includes(product.id)).flatMap(product => [product.nome, product.codice]);
      return matchesActivitySearch(item, text, [projectTitle, customerName, departmentName, productName, ...linkedProducts]);
    });
  }, [activities, query, projects, products, customerDirectory, phaseProducts]);

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
      const dayItems = filteredActivities.filter((item) => activityOnDay(item, dateKey));
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
  }, [filteredActivities, currentMonth, selectedDate]);

  const monthItems = useMemo(() => {
    const month = currentMonth.getMonth();
    const year = currentMonth.getFullYear();
    return filteredActivities.filter(item => activityInMonth(item, year, month));
  }, [filteredActivities, currentMonth]);

  function filterActivities(items, filter) {
    if (filter === 'production') return items.filter(item => item.tipo === 'production');
    if (filter === "plannedTasks") return items.filter((item) => item.tipo === "task" && !isTaskDone(item) && !isOverdue(item));
    if (filter === "overdueTasks") return items.filter((item) => item.tipo === "task" && isOverdue(item));
    if (filter === "plannedReminders") return items.filter((item) => item.tipo === "reminder" && !isReminderDone(item) && !isOverdue(item));
    if (filter === "overdueReminders") return items.filter((item) => item.tipo === "reminder" && isOverdue(item));
    return items;
  }

  const selectedItems = useMemo(() => {
    if (activityFilter) return filterActivities(monthItems, activityFilter);
    return filteredActivities.filter((item) => activityOnDay(item, selectedDate));
  }, [filteredActivities, selectedDate, activityFilter, monthItems]);

  const monthStats = useMemo(() => {
    const monthTasks = monthItems.filter((item) => item.tipo === "task");
    const monthReminders = monthItems.filter((item) => item.tipo === "reminder");
    return {
      plannedTasks: monthTasks.filter((item) => !isTaskDone(item) && !isOverdue(item)).length,
      production: monthItems.filter(item => item.tipo === 'production').length,
      overdueTasks: monthTasks.filter(isOverdue).length,
      plannedReminders: monthReminders.filter((item) => !isReminderDone(item) && !isOverdue(item)).length,
      overdueReminders: monthReminders.filter(isOverdue).length,
    };
  }, [monthItems]);

  const sidePanelTitle = activityFilter
    ? {
        production: 'Lavorazioni nel mese',
        plannedTasks: "Task/fasi pianificate nel mese",
        overdueTasks: "Task/fasi scadute nel mese",
        plannedReminders: "Reminder pianificati nel mese",
        overdueReminders: "Reminder scaduti nel mese",
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

  function openActivity(item) {
    setDayPopup(null); setActivityFilter(null); setActivityPopup(item);
  }
  function openDay(day) { setSelectedDate(day); setActivityFilter(null); setDayPopup(day); }
  function moveWeek(offset) {
    const date = new Date(selectedDate + 'T12:00:00'); date.setDate(date.getDate() + offset * 7);
    setSelectedDate(formatDateForQuery(date)); setCurrentMonth(new Date(date.getFullYear(), date.getMonth(), 1)); setActivityFilter(null);
  }
  const weekDays = useMemo(() => {
  const weekStart = new Date(selectedDate + 'T12:00:00');
  weekStart.setDate(weekStart.getDate() - (weekStart.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart); date.setDate(date.getDate() + index);
    const key = formatDateForQuery(date);
    return { date, key, items: filteredActivities.filter(item => activityOnDay(item, key)) };
  });
  }, [selectedDate, filteredActivities]);

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
    if (adminMode) return true;
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

  const planningPath = hasScreenAccess?.('progremes.PlanningProduction')
    ? '/produzione/progremes.PlanningProduction'
    : hasModuleAccess?.('progremes') && hasScreenAccess?.('progremes.Planning', 'progremes')
      ? '/produzione/progremes.Planning' : '';
  const planningToolbar = (<div className="v4-toolbar planning-toolbar-clean dashboard-planning-toolbar">
        <div className="task-search">
          <Search size={18} />
          <input
            placeholder="Cerca Station, Filling, RdP, OCT, FP, prodotto, cliente, attività..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {planningPath && <button type="button" className="primary-action" onClick={() => requestProgremesWorkspaceWindow(planningPath)}><CalendarDays size={18} />Apri Planning</button>}
      </div>);

  return (
    <div className="calendar-page dashboard-activities-page">
      <div className="page-title-row">
        <div>
          <h1>Le mie attività</h1>
          <p>Task, reminder, preparazione e confezionamento.</p>
        </div>

      </div>

      {production.error && <div role="alert" className="panel" style={{ color: '#b91c1c', padding: 16 }}>{production.error}</div>}
      {production.warning && <div role="status" className="panel" style={{ color: '#854d0e', background: '#fef9c3', padding: 16 }}>{production.warning}</div>}
      <DashboardActivityToolbar loading={loading} monthStats={monthStats} activityFilter={activityFilter} setActivityFilter={setActivityFilter} openNewPhase={openNewPhase} openNewReminder={openNewReminder} goToday={goToday} />

      {toolbarTarget ? createPortal(planningToolbar, toolbarTarget) : planningToolbar}

      <div className="calendar-layout-grid dashboard-planning-top">
        <section className="panel dashboard-week-panel">
          <div className="panel-header"><button className="secondary-action" aria-label="Settimana precedente" onClick={() => moveWeek(-1)}><ChevronLeft size={18} /></button><div><h3>Planning settimanale</h3><p>{formatDateHuman(weekDays[0].key)} – {formatDateHuman(weekDays[6].key)}</p></div><button className="secondary-action" aria-label="Settimana successiva" onClick={() => moveWeek(1)}><ChevronRight size={18} /></button></div>
          <div className="dashboard-week-scroll"><div className="dashboard-week-days">{weekDays.map(day => <section key={day.key} className={day.key === selectedDate ? 'selected' : ''}>
            <button className="dashboard-week-date" onClick={() => openDay(day.key)}>{formatDisplayDate(day.date, { weekday: 'short', day: 'numeric', month: 'short' })}<small>{day.items.length} attività</small></button>
            {day.items.map(item => <button key={item.id} className="calendar-task-card" onClick={() => openActivity(item)}><small className={item.tipo === 'production' ? `production-label ${item.reparto === 'Preparazione' ? 'preparation' : 'packaging'}` : 'activity-kind task-kind'}>{item.tipo === 'production' ? item.reparto : item.tipo === 'reminder' ? 'Reminder' : 'Task / fase'}</small><strong>{item.titolo}</strong><span>{item.tipo === 'production' ? item.resource : statusLabel(item)}</span></button>)}
          </section>)}</div></div>
        </section>

      </div>

        <div className="panel calendar-main-panel">
          <div className="calendar-main-header">
            <button type="button" onClick={() => changeMonth(-1)}><ChevronLeft size={20} /></button>
            <div style={{ display: "grid", gap: "6px", justifyItems: "center" }}>
              <h3>{formatMonth(currentMonth)}</h3>
              <DashboardColorLegend />
            </div>
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
                    onClick={() => { openDay(day.dateKey); }}
                  >
                    <span className="day-number">{day.date.getDate()}</span>
                    {day.items.length > 0 && (
                      <div className="dashboard-day-counts">
                        {['Preparazione', 'Confezionamento'].map(label => { const count = day.items.filter(item => item.tipo === 'production' && item.reparto === label).length; return count > 0 && <span key={label} className={`dashboard-day-line production-label ${label === 'Preparazione' ? 'preparation' : 'packaging'}`}>{label} {count}</span>; })}
                        {day.plannedTasks > 0 && <span style={{ borderRadius: "999px", padding: "2px 8px", background: "#e0f2fe", color: "#1d4ed8", fontSize: "12px", fontWeight: 700 }}>Task {day.plannedTasks}</span>}
                        {day.overdueTasks > 0 && <span className="dashboard-day-line danger">Task scad. {day.overdueTasks}</span>}
                        {day.plannedReminders > 0 && <span style={{ borderRadius: "999px", padding: "2px 8px", background: "#e0f2fe", color: "#1d4ed8", fontSize: "12px", fontWeight: 700 }}>Rem. {day.plannedReminders}</span>}
                        {day.overdueReminders > 0 && <span className="dashboard-day-line danger">Rem. scad. {day.overdueReminders}</span>}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
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

      {activityFilter && <PlanningDialog title={sidePanelTitle} onClose={() => setActivityFilter(null)}>
        {selectedItems.length === 0 && <p>Nessuna attività per questo filtro.</p>}
        <ActivityGroup title={sidePanelTitle} danger={activityFilter.includes('overdue')} items={selectedItems} onOpen={openActivity} />
      </PlanningDialog>}
      {dayPopup && <PlanningDialog title={formatDateHuman(dayPopup)} onClose={() => setDayPopup(null)}>
        {filteredActivities.filter(item => activityOnDay(item, dayPopup)).length === 0 && <p>Nessuna attività per questo giorno.</p>}
        <ProductionGroup onOpen={openActivity} items={filteredActivities.filter(item => item.tipo === 'production' && activityOnDay(item, dayPopup))} />
        <ActivityGroup title="Task, fasi e reminder" items={filteredActivities.filter(item => item.tipo !== 'production' && activityOnDay(item, dayPopup))} onOpen={openActivity} />
      </PlanningDialog>}
      {activityPopup && <CostModal title={activityPopup.titolo} data-record-id={activityPopup.productionOrderId || activityPopup.id} data-order-number={activityPopup.orderNumber} data-article-code={activityPopup.articleCode} data-phase={activityPopup.reparto} onClose={() => setActivityPopup(null)}>
        <p><strong className={activityPopup.tipo === 'production' ? `production-label ${activityPopup.reparto === 'Preparazione' ? 'preparation' : 'packaging'}` : undefined}>{activityPopup.tipo === 'production' ? activityPopup.reparto : statusLabel(activityPopup)}</strong></p>
        <p>{activityPopup.descrizione || 'Nessuna descrizione'}</p>
        {activityPopup.tipo === 'production' ? <><div className="pc-metrics"><div><span>Risorsa</span><strong>{activityPopup.resource}</strong></div><div><span>Periodo</span><strong>{displayDate(activityPopup.start, true)} – {displayDate(activityPopup.end, true)}</strong></div><div><span>Stato</span><strong>{activityPopup.stato}</strong></div></div>{activityPopup.operationType === 'Production' && <div className="dashboard-production-actions"><PreparationActions key={activityPopup.id} activity={activityPopup} onStarted={() => setActivityPopup(current => current ? { ...current, stato: 'In lavorazione' } : current)}/></div>}{activityPopup.reparto === 'Confezionamento' && <div className="dashboard-production-actions"><ProductSpecificationViewButton key={activityPopup.articleCode} articleCode={activityPopup.articleCode} description={activityPopup.descrizione}/><PackagingSheetActions productionOrderId={activityPopup.productionOrderId}/><PackagingOperationalActions key={activityPopup.id} productionOrderId={activityPopup.productionOrderId} resourceCode={activityPopup.resourceCode} orderNumber={activityPopup.orderNumber} articleCode={activityPopup.articleCode} operationType={activityPopup.operationType} onStarted={() => setActivityPopup(current => current ? { ...current, stato: 'In lavorazione' } : current)}/></div>}</> : <><p>Scadenza: {activityPopup.deadline ? formatDateHuman(dateOnly(activityPopup.deadline)) : 'Non impostata'}</p><button className="primary-action" onClick={() => { const item = activityPopup; setActivityPopup(null); if (item.tipo === 'reminder') { setSelectedReminder(item); setReminderForm({ ...emptyReminderForm, ...item, deadline: dateOnly(item.deadline) || '' }); setReminderModalOpen(true); } else openPhaseEdit(item); }}>Apri dettaglio e azioni</button></>}
      </CostModal>}
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

function PlanningDialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="dashboard-planning-dialog" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-header"><h2>{title}</h2><button type="button" aria-label="Chiudi" onClick={onClose}><X size={20} /></button></div><div className="dashboard-dialog-content">{children}</div></dialog>;
}

function ProductionGroup({ items, onOpen }) {
  if (!items.length) return null;
  const time = value => `${value.slice(8, 10)}/${value.slice(5, 7)} ${value.slice(11, 16)}`;
  return <section className="dashboard-activity-group">
    <h4>Preparazione e confezionamento</h4>
    {[...items].sort((a, b) => a.start.localeCompare(b.start)).map(item => <button type="button" onClick={() => onOpen(item)} key={item.id} className="calendar-task-card" style={{ background: '#eef4ff', borderColor: '#bfd3ff', display: 'grid', gap: 6 }}>
      <strong>{item.titolo}</strong><span>{item.descrizione}</span>
      <small className={`production-label ${item.reparto === 'Preparazione' ? 'preparation' : 'packaging'}`}>{item.reparto}{item.resource ? ` · ${item.resource}` : ''}</small><span>{time(item.start)} – {time(item.end)}</span>
      <small>{item.stato} · {item.forecast ? 'Previsione' : 'Pianificazione'}</small>
    </button>)}
  </section>;
}

function ActivityGroup({ title, items, danger = false, done = false, onOpen }) {
  if (!items.length) return null;
  return (
    <div className="dashboard-activity-group">
      <h4
        className={danger ? "danger" : done ? "done" : ""}
        style={!danger && !done ? { color: "#1d4ed8" } : undefined}
      >
        {title}
      </h4>
      {items.map((item) => (
        <button
          key={`${item.tipo}-${item.id}`}
          className={`calendar-task-card ${danger ? "overdue" : ""}`}
          style={
            danger
              ? { borderColor: "#fee2e2", background: "#fee2e2", color: "#b91c1c" }
              : done
                ? { borderColor: "#dcfce7", background: "#dcfce7", color: "#15803d" }
                : { borderColor: "#e0f2fe", background: "#e0f2fe", color: "#1d4ed8" }
          }
          onClick={() => onOpen(item)}
        >
          <small className="activity-kind task-kind">{item.tipo === "reminder" ? "Reminder" : "Task/fase"}</small>
          <strong>{item.titolo}</strong>
          <span>{item.tipo === "reminder" ? "Reminder personale" : item.v4_progetti?.titolo || "Senza progetto"}</span>
          <small>{statusLabel(item)} · {item.tipo === "task" ? item.reparti?.nome || "Reparto" : "Personale"}</small>
        </button>
      ))}
    </div>
  );
}

export default Dashboard;

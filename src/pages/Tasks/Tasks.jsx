import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Search } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

const CLOSED_STATES = ["evaso", "evasa", "completato", "completata", "chiuso", "chiusa"];

function normalize(value) {
  return String(value || "").trim().toLowerCase().replaceAll(" ", "_");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function dateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function isDone(item) {
  return CLOSED_STATES.includes(normalize(item?.stato)) || Boolean(item?.completato_at);
}

function phaseStatus(item) {
  const deadline = dateOnly(item?.deadline);
  if (isDone(item)) return "Completata";
  if (deadline && deadline < todayIso()) return "Scaduta";
  if (deadline === todayIso()) return "Oggi";
  if (normalize(item?.stato) === "in_lavorazione") return "In lavorazione";
  if (normalize(item?.stato) === "in_valutazione") return "In valutazione";
  return "Aperta";
}

function statusClass(item) {
  const status = phaseStatus(item);
  if (status === "Completata") return "done";
  if (status === "Scaduta") return "danger";
  if (status === "Oggi") return "today";
  return "open";
}

function formatDate(value, options = {}) {
  const date = dateOnly(value);
  if (!date) return "Senza data";
  return new Date(`${date}T00:00:00`).toLocaleDateString("it-IT", options.weekday ? { weekday: "short", day: "2-digit", month: "short" } : { day: "2-digit", month: "short", year: "numeric" });
}

function monthTitle(date) {
  return date.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export default function Tasks() {
  const { profile, hasPermission, isAdmin, userDepartmentIds = [] } = useAuth();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(params.get("date") || todayIso());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState(params.get("filter") || "tutte");
  const [projects, setProjects] = useState([]);
  const [phases, setPhases] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [phaseDepartments, setPhaseDepartments] = useState([]);
  const [phaseProducts, setPhaseProducts] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedPhase, setSelectedPhase] = useState(null);
  const [loading, setLoading] = useState(true);

  const actorId = profile?.id || null;
  const canReadAllProjects = hasPermission?.("projects.read.all") || hasPermission?.("tasks.read.all") || isAdmin?.();
  const canReadAllTasksInVisibleProjects = canReadAllProjects || hasPermission?.("tasks.read.project_departments");

  useEffect(() => {
    if (profile?.id) loadPlanning();
  }, [profile?.id, userDepartmentIds.join(",")]);

  useEffect(() => {
    const nextParams = {};
    if (selectedDate) nextParams.date = selectedDate;
    if (statusFilter !== "tutte") nextParams.filter = statusFilter;
    setParams(nextParams, { replace: true });
  }, [selectedDate, statusFilter]);

  async function loadPlanning() {
    setLoading(true);

    const [projectsRes, phasesRes, projectDepartmentsRes, phaseDepartmentsRes, departmentsRes, phaseProductsRes, productsRes] = await Promise.all([
      supabase.from("v4_progetti").select("id,titolo,descrizione,deadline,priorita,stato,created_at").order("created_at", { ascending: false }),
      supabase
        .from("v4_fasi_progetto")
        .select("*,v4_progetti(id,titolo,descrizione),reparti(id,nome)")
        .order("deadline", { ascending: true, nullsFirst: false })
        .order("ordine", { ascending: true }),
      supabase.from("v4_progetto_reparti").select("id,progetto_id,reparto_id"),
      supabase.from("v4_fase_reparti").select("id,fase_id,reparto_id,completato,completato_at,completato_da"),
      supabase.from("reparti").select("id,nome,attivo").order("nome"),
      supabase.from("v4_fase_prodotti").select("id,fase_id,prodotto_id,prodotto_nome"),
      supabase.from("prodotti").select("id,nome,codice").order("nome").limit(5000),
    ]);

    if (projectsRes.error) console.error("Planning progetti:", projectsRes.error.message);
    if (phasesRes.error) console.error("Planning fasi:", phasesRes.error.message);
    if (projectDepartmentsRes.error) console.error("Planning reparti progetto:", projectDepartmentsRes.error.message);
    if (phaseDepartmentsRes.error) console.error("Planning reparti fase:", phaseDepartmentsRes.error.message);

    const allProjects = projectsRes.data || [];
    const allPhases = phasesRes.data || [];
    const allProjectDepartments = projectDepartmentsRes.data || [];
    const allPhaseDepartments = phaseDepartmentsRes.data || [];
    const allowedDepartmentIds = safeArray(userDepartmentIds);

    const visibleProjectIds = new Set(
      canReadAllProjects
        ? allProjects.map((project) => project.id)
        : allProjects
            .filter((project) => {
              const ids = allProjectDepartments.filter((row) => row.progetto_id === project.id).map((row) => row.reparto_id).filter(Boolean);
              if (!ids.length) return true;
              return ids.some((id) => allowedDepartmentIds.includes(id));
            })
            .map((project) => project.id)
    );

    const visiblePhases = (canReadAllProjects || canReadAllTasksInVisibleProjects)
      ? allPhases.filter((phase) => visibleProjectIds.has(phase.progetto_id))
      : allPhases.filter((phase) => {
          if (!visibleProjectIds.has(phase.progetto_id)) return false;
          const ids = allPhaseDepartments.filter((row) => row.fase_id === phase.id).map((row) => row.reparto_id).filter(Boolean);
          if (ids.length) return ids.some((id) => allowedDepartmentIds.includes(id));
          if (!phase.reparto_id) return true;
          return allowedDepartmentIds.includes(phase.reparto_id);
        });

    const visiblePhaseIds = new Set(visiblePhases.map((phase) => phase.id));
    setProjects(allProjects.filter((project) => visibleProjectIds.has(project.id)));
    setPhases(visiblePhases);
    setDepartments((departmentsRes.data || []).filter((item) => item.attivo !== false));
    setPhaseDepartments(allPhaseDepartments.filter((row) => visiblePhaseIds.has(row.fase_id)));
    setPhaseProducts((phaseProductsRes.data || []).filter((row) => visiblePhaseIds.has(row.fase_id)));
    setProducts(productsRes.data || []);
    setLoading(false);
  }

  const departmentsByPhase = useMemo(() => {
    const map = new Map();
    phaseDepartments.forEach((row) => {
      const department = departments.find((item) => item.id === row.reparto_id);
      const list = map.get(row.fase_id) || [];
      if (department) {
        list.push({
          ...department,
          fase_reparto_id: row.id,
          completato: Boolean(row.completato),
          completato_at: row.completato_at,
          completato_da: row.completato_da,
        });
      }
      map.set(row.fase_id, list);
    });
    return map;
  }, [phaseDepartments, departments]);

  const productsByPhase = useMemo(() => {
    const map = new Map();
    phaseProducts.forEach((row) => {
      const list = map.get(row.fase_id) || [];
      const product = products.find((item) => item.id === row.prodotto_id);
      list.push(product?.nome || row.prodotto_nome || "Prodotto");
      map.set(row.fase_id, list);
    });
    return map;
  }, [phaseProducts, products]);

  const enrichedPhases = useMemo(() => {
    return phases.map((phase) => ({
      ...phase,
      deadline_day: dateOnly(phase.deadline),
      planningDepartments: departmentsByPhase.get(phase.id) || (phase.reparti ? [{ ...phase.reparti, completato: isDone(phase) }] : []),
      planningProducts: productsByPhase.get(phase.id) || [],
    }));
  }, [phases, departmentsByPhase, productsByPhase]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return enrichedPhases.filter((phase) => {
      if (statusFilter === "aperte" && isDone(phase)) return false;
      if (statusFilter === "oggi" && !(phase.deadline_day === todayIso() && !isDone(phase))) return false;
      if (statusFilter === "scadute" && !(phase.deadline_day && phase.deadline_day < todayIso() && !isDone(phase))) return false;
      if (statusFilter === "completate" && !isDone(phase)) return false;
      if (!text) return true;

      const haystack = [
        phase.titolo,
        phase.descrizione,
        phase.note,
        phase.v4_progetti?.titolo,
        phase.reparti?.nome,
        ...phase.planningDepartments.map((item) => item.nome),
        ...phase.planningProducts,
      ].join(" ").toLowerCase();
      return haystack.includes(text);
    });
  }, [enrichedPhases, query, statusFilter]);

  const days = useMemo(() => {
    if (view === "day") return [{ key: selectedDate, date: new Date(`${selectedDate}T00:00:00`), inMonth: true }];
    if (view === "week") {
      const base = new Date(cursor);
      const start = addDays(base, -((base.getDay() + 6) % 7));
      return Array.from({ length: 7 }, (_, index) => {
        const date = addDays(start, index);
        return { key: iso(date), date, inMonth: true };
      });
    }

    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => {
      const date = addDays(start, index);
      return { key: iso(date), date, inMonth: date.getMonth() === cursor.getMonth() };
    });
  }, [view, cursor, selectedDate]);

  const phasesByDay = useMemo(() => {
    const map = new Map();
    filtered.forEach((phase) => {
      const key = phase.deadline_day || "senza-data";
      const list = map.get(key) || [];
      list.push(phase);
      map.set(key, list);
    });
    return map;
  }, [filtered]);

  const selectedItems = phasesByDay.get(selectedDate) || [];
  const undatedItems = phasesByDay.get("senza-data") || [];

  const totals = useMemo(() => ({
    open: filtered.filter((phase) => !isDone(phase)).length,
    today: filtered.filter((phase) => phase.deadline_day === todayIso() && !isDone(phase)).length,
    overdue: filtered.filter((phase) => phase.deadline_day && phase.deadline_day < todayIso() && !isDone(phase)).length,
    done: filtered.filter(isDone).length,
  }), [filtered]);

  function daySummary(items) {
    return {
      open: items.filter((phase) => !isDone(phase)).length,
      overdue: items.filter((phase) => phaseStatus(phase) === "Scaduta").length,
      done: items.filter(isDone).length,
    };
  }

  function selectDay(dayKey) {
    setSelectedDate(dayKey);
    if (view === "month") setView("day");
  }

  function moveCursor(direction) {
    if (view === "month") setCursor((current) => addMonths(current, direction));
    else if (view === "week") setCursor((current) => addDays(current, direction * 7));
    else setSelectedDate((current) => iso(addDays(new Date(`${current}T00:00:00`), direction)));
  }

  function canCompleteDepartment(departmentId) {
    if (hasPermission?.("projects.write") || hasPermission?.("tasks.complete.any_department") || canReadAllProjects) return true;
    if (!departmentId) return true;
    return safeArray(userDepartmentIds).includes(departmentId);
  }

  async function log(entity_type, entity_id, azione, dettagli) {
    await supabase.from("v4_audit_log").insert({ entity_type, entity_id, azione, dettagli: { testo: dettagli || "" }, user_id: actorId });
  }

  async function completeWholePhase(phase) {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("v4_fasi_progetto")
      .update({ stato: "evaso", completato_da: actorId, completato_at: now, modificato_da: actorId, updated_at: now })
      .eq("id", phase.id);

    if (error) return alert(error.message);
    await log("fase_progetto", phase.id, "fase evasa", phase.titolo);
    await loadPlanning();
  }

  async function completeDepartmentPhase(phase, department) {
    if (!canCompleteDepartment(department.id)) return alert("Non hai i permessi per completare questo reparto.");

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("v4_fase_reparti")
      .update({ completato: true, completato_at: now, completato_da: actorId })
      .eq("fase_id", phase.id)
      .eq("reparto_id", department.id);

    if (error) return alert(error.message);

    const { data: rows, error: rowsError } = await supabase.from("v4_fase_reparti").select("reparto_id,completato").eq("fase_id", phase.id);
    if (rowsError) return alert(rowsError.message);

    const allCompleted = (rows || []).length > 0 && (rows || []).every((row) => Boolean(row.completato));
    const payload = allCompleted
      ? { stato: "evaso", completato_da: actorId, completato_at: now, modificato_da: actorId, updated_at: now }
      : { stato: "in_lavorazione", completato_da: null, completato_at: null, modificato_da: actorId, updated_at: now };

    const { error: phaseError } = await supabase.from("v4_fasi_progetto").update(payload).eq("id", phase.id);
    if (phaseError) return alert(phaseError.message);

    await log("fase_progetto", phase.id, allCompleted ? "fase evasa da tutti i reparti" : "reparto completato", `${phase.titolo || "Fase"} · ${department.nome}`);
    await loadPlanning();
  }

  async function reopenDepartmentPhase(phase, department) {
    if (!hasPermission?.("projects.write") && !hasPermission?.("tasks.reopen") && !canReadAllProjects) return alert("Non hai i permessi per riaprire questo reparto.");

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("v4_fase_reparti")
      .update({ completato: false, completato_at: null, completato_da: null })
      .eq("fase_id", phase.id)
      .eq("reparto_id", department.id);

    if (error) return alert(error.message);

    const { error: phaseError } = await supabase
      .from("v4_fasi_progetto")
      .update({ stato: "in_lavorazione", completato_da: null, completato_at: null, modificato_da: actorId, updated_at: now })
      .eq("id", phase.id);

    if (phaseError) return alert(phaseError.message);
    await log("fase_progetto", phase.id, "reparto riaperto", `${phase.titolo || "Fase"} · ${department.nome}`);
    await loadPlanning();
  }

  function PhaseCard({ phase, compact = false }) {
    const departments = phase.planningDepartments || [];
    const productsList = phase.planningProducts || [];
    const visibleProject = projects.find((project) => project.id === phase.progetto_id);

    return (
      <article className={`planning-task-card ${statusClass(phase)} ${compact ? "compact" : ""}`}>
        <button className="planning-task-main" type="button" onClick={() => setSelectedPhase(phase)}>
          <div className="planning-task-title-row">
            <strong>{phase.titolo || "Fase senza titolo"}</strong>
            <span className={`status-pill ${statusClass(phase)}`}>{phaseStatus(phase)}</span>
          </div>
          <span>{phase.v4_progetti?.titolo || visibleProject?.titolo || "Progetto non impostato"}</span>
          <small>{departments.map((department) => department.nome).join(", ") || phase.reparti?.nome || "Reparto non impostato"}</small>
          {productsList.length > 0 && <small>Prodotti: {productsList.join(", ")}</small>}
          {phase.descrizione && <p>{phase.descrizione}</p>}
        </button>

        <div className="planning-department-actions">
          {departments.length > 0 ? (
            departments.map((department) =>
              department.completato ? (
                <button key={department.id} type="button" className="reopen-phase-btn" onClick={() => reopenDepartmentPhase(phase, department)} title={department.completato_at ? `Completato il ${new Date(department.completato_at).toLocaleString("it-IT")}` : "Reparto completato"}>
                  <Clock3 size={15} /> Riapri {department.nome}
                </button>
              ) : (
                <button key={department.id} type="button" className="complete-phase-btn" onClick={() => completeDepartmentPhase(phase, department)} disabled={!canCompleteDepartment(department.id)}>
                  <CheckCircle2 size={15} /> Completa {department.nome}
                </button>
              )
            )
          ) : !isDone(phase) ? (
            <button type="button" className="complete-phase-btn" onClick={() => completeWholePhase(phase)}>
              <CheckCircle2 size={15} /> Completa fase
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <div className="tasks-page v4-page planning-clean-page">
      <div className="page-title-row">
        <div>
          <h1>Planning fasi</h1>
          <p>Vista chiara delle attività per data, progetto, reparto e stato di avanzamento.</p>
        </div>
      </div>

      <div className="planning-kpi-row">
        <div className="planning-kpi-card"><span>Aperte</span><strong>{totals.open}</strong></div>
        <div className="planning-kpi-card today"><span>Oggi</span><strong>{totals.today}</strong></div>
        <div className="planning-kpi-card danger"><span>Scadute</span><strong>{totals.overdue}</strong></div>
        <div className="planning-kpi-card done"><span>Completate</span><strong>{totals.done}</strong></div>
      </div>

      <div className="v4-toolbar planning-toolbar-clean">
        <div className="task-search">
          <Search size={18} />
          <input placeholder="Cerca task, progetto, reparto o prodotto..." value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>

        <div className="status-tabs">
          {[
            ["tutte", "Tutte"],
            ["aperte", "Aperte"],
            ["oggi", "Oggi"],
            ["scadute", "Scadute"],
            ["completate", "Completate"],
          ].map(([value, label]) => (
            <button key={value} className={statusFilter === value ? "active" : ""} onClick={() => setStatusFilter(value)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="planning-navigation panel">
        <div className="planning-nav-left">
          <button type="button" className="icon-action" onClick={() => moveCursor(-1)}><ChevronLeft size={18} /> Indietro</button>
          <div>
            <strong>{view === "month" ? monthTitle(cursor) : view === "week" ? "Settimana" : formatDate(selectedDate)}</strong>
            <span>{filtered.length} attività visualizzate</span>
          </div>
          <button type="button" className="icon-action" onClick={() => moveCursor(1)}>Avanti <ChevronRight size={18} /></button>
        </div>

        <div className="planning-view-tabs">
          {[["month", "Mese"], ["week", "Settimana"], ["day", "Giorno"]].map(([value, label]) => (
            <button key={value} className={view === value ? "active" : ""} onClick={() => setView(value)}>{label}</button>
          ))}
          <button onClick={() => { setCursor(new Date()); setSelectedDate(todayIso()); }}>Oggi</button>
        </div>
      </div>

      {loading ? (
        <div className="panel"><p className="empty-text">Caricamento planning...</p></div>
      ) : view === "month" ? (
        <div className="planning-month-panel panel">
          <div className="planning-week-labels"><span>Lun</span><span>Mar</span><span>Mer</span><span>Gio</span><span>Ven</span><span>Sab</span><span>Dom</span></div>
          <div className="planning-grid month clean-month">
            {days.map((day) => {
              const items = phasesByDay.get(day.key) || [];
              const summary = daySummary(items);
              return (
                <button key={day.key} className={`planning-day clean ${day.inMonth === false ? "muted" : ""} ${selectedDate === day.key ? "selected" : ""}`} type="button" onClick={() => selectDay(day.key)}>
                  <strong>{formatDate(day.key, { weekday: true })}</strong>
                  {items.length === 0 ? <span className="planning-empty-day">Nessuna attività</span> : (
                    <div className="planning-day-summary">
                      <span className="summary-line open">Aperte <b>{summary.open}</b></span>
                      <span className="summary-line danger">Scadute <b>{summary.overdue}</b></span>
                      <span className="summary-line done">Completate <b>{summary.done}</b></span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : view === "week" ? (
        <div className="planning-week-list">
          {days.map((day) => {
            const items = phasesByDay.get(day.key) || [];
            return (
              <section className="panel planning-week-day" key={day.key}>
                <button type="button" className="planning-week-day-title" onClick={() => selectDay(day.key)}>
                  <strong>{formatDate(day.key, { weekday: true })}</strong>
                  <span>{items.length} attività</span>
                </button>
                {items.length === 0 ? <p className="empty-text">Nessuna attività.</p> : <div className="planning-task-list">{items.map((phase) => <PhaseCard key={phase.id} phase={phase} compact />)}</div>}
              </section>
            );
          })}
        </div>
      ) : null}

      <div className="v4-split planning-detail-split">
        <section className="panel">
          <div className="panel-header">
            <h3>Attività del giorno · {formatDate(selectedDate, { weekday: true })}</h3>
          </div>
          {selectedItems.length === 0 ? (
            <div className="empty-planning-box">
              <CalendarDays size={34} />
              <strong>Nessuna attività con deadline in questa giornata</strong>
              <span>Controlla i filtri o passa alla vista mese/settimana.</span>
            </div>
          ) : (
            <div className="planning-task-list">{selectedItems.map((phase) => <PhaseCard key={phase.id} phase={phase} />)}</div>
          )}
        </section>

        <aside className="panel detail-panel">
          <div className="panel-header"><h3>Dettaglio fase</h3><CalendarDays size={20} /></div>
          {!selectedPhase ? (
            <p className="empty-text">Seleziona una fase per vedere riepilogo, reparto e avanzamento.</p>
          ) : (
            <div className="detail-card planning-selected-card">
              <h2>{selectedPhase.titolo}</h2>
              <p>{selectedPhase.descrizione || selectedPhase.note || "Nessuna descrizione."}</p>
              <div className="mini-meta">
                <span>Progetto: {selectedPhase.v4_progetti?.titolo || "-"}</span>
                <span>Deadline: {formatDate(selectedPhase.deadline)}</span>
                <span>Stato: {phaseStatus(selectedPhase)}</span>
                <span>Reparti: {(selectedPhase.planningDepartments || []).map((item) => item.nome).join(", ") || selectedPhase.reparti?.nome || "-"}</span>
              </div>
            </div>
          )}
        </aside>
      </div>

      {undatedItems.length > 0 && (
        <section className="panel">
          <div className="panel-header"><h3>Attività senza deadline</h3></div>
          <div className="planning-task-list">{undatedItems.map((phase) => <PhaseCard key={phase.id} phase={phase} />)}</div>
        </section>
      )}
    </div>
  );
}

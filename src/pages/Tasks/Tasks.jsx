import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, CheckCircle2, Search } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDays(date, days) { const next = new Date(date); next.setDate(next.getDate() + days); return next; }
function iso(date) { return date.toISOString().slice(0, 10); }
function isDone(item) { return ["evaso", "evasa", "completato", "completata", "chiuso", "chiusa"].includes(String(item?.stato || "").toLowerCase()) || item.completato_at; }
function status(item) { if (isDone(item)) return "Completata"; if (item.deadline && item.deadline < todayIso()) return "Scaduta"; if (item.deadline === todayIso()) return "Oggi"; return item.stato || "Da evadere"; }
function cls(item) { const s = status(item); if (s === "Completata") return "done"; if (s === "Scaduta") return "danger"; if (s === "Oggi") return "today"; return "open"; }
function formatDate(date) { return date ? new Date(`${date}T00:00:00`).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" }) : "Senza data"; }

function Tasks() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(params.get("date") || todayIso());
  const [query, setQuery] = useState("");
  const [phases, setPhases] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  const activeFilter = params.get("filter") || "tutte";

  useEffect(() => { loadPhases(); }, [profile?.id, profile?.reparto_id]);

  async function loadPhases() {
    setLoading(true);
    let queryBuilder = supabase
      .from("v4_fasi_progetto")
      .select("*,v4_progetti(id,titolo),reparti(id,nome)")
      .order("deadline", { ascending: true, nullsFirst: false });
    if (profile?.reparto_id) queryBuilder = queryBuilder.eq("reparto_id", profile.reparto_id);
    const { data, error } = await queryBuilder;
    if (error) console.error(error);
    setPhases(data || []);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return phases.filter((item) => {
      if (text && !`${item.titolo || ""} ${item.descrizione || ""} ${item.note || ""} ${item.v4_progetti?.titolo || ""} ${item.reparti?.nome || ""}`.toLowerCase().includes(text)) return false;
      if (activeFilter === "aperte") return !isDone(item);
      if (activeFilter === "oggi") return item.deadline === todayIso() && !isDone(item);
      if (activeFilter === "scadute") return item.deadline && item.deadline < todayIso() && !isDone(item);
      if (activeFilter === "completate") return isDone(item);
      return true;
    });
  }, [phases, query, activeFilter]);

  const days = useMemo(() => {
    if (view === "day") return [{ key: selectedDate, date: new Date(`${selectedDate}T00:00:00`) }];
    if (view === "week") {
      const base = new Date(cursor);
      const start = addDays(base, -((base.getDay() + 6) % 7));
      return Array.from({ length: 7 }, (_, i) => { const date = addDays(start, i); return { key: iso(date), date }; });
    }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => { const date = addDays(start, i); return { key: iso(date), date, inMonth: date.getMonth() === cursor.getMonth() }; });
  }, [view, cursor, selectedDate]);

  const byDay = useMemo(() => {
    const map = new Map();
    filtered.forEach((item) => { const key = item.deadline || "senza-data"; map.set(key, [...(map.get(key) || []), item]); });
    return map;
  }, [filtered]);

  const selectedItems = byDay.get(selectedDate) || [];

  async function completePhase(item) {
    const { error } = await supabase.from("v4_fasi_progetto").update({ stato: "Evaso", completato_da: profile?.id || null, completato_at: new Date().toISOString(), modificato_da: profile?.id || null, updated_at: new Date().toISOString() }).eq("id", item.id);
    if (error) return alert(error.message);
    await supabase.from("v4_audit_log").insert({ entity_type: "fase_progetto", entity_id: item.id, azione: "fase evasa", dettagli: item.titolo, user_id: profile?.id || null });
    await loadPhases();
  }

  function daySummary(items) {
    return { open: items.filter((i) => !isDone(i)).length, done: items.filter(isDone).length, danger: items.filter((i) => status(i) === "Scaduta").length };
  }

  return (
    <div className="tasks-page v4-page">
      <div className="page-title-row"><div><h1>Planning fasi</h1><p>Le task sono fasi di progetto: checklist operative per reparto.</p></div></div>
      <div className="v4-toolbar"><div className="task-search"><Search size={18} /><input placeholder="Cerca tutto nelle fasi..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>{["month", "week", "day"].map((v) => <button key={v} className={`filter-chip ${view === v ? "active" : ""}`} onClick={() => setView(v)}>{v === "month" ? "Mese" : v === "week" ? "Settimana" : "Giorno"}</button>)}{["tutte", "aperte", "oggi", "scadute", "completate"].map((f) => <button key={f} className={`filter-chip ${activeFilter === f ? "active" : ""}`} onClick={() => setParams(f === "tutte" ? {} : { filter: f })}>{f}</button>)}<button className="filter-chip" onClick={() => setCursor(addDays(cursor, view === "week" ? -7 : -30))}>Indietro</button><button className="filter-chip" onClick={() => { setCursor(new Date()); setSelectedDate(todayIso()); }}>Oggi</button><button className="filter-chip" onClick={() => setCursor(addDays(cursor, view === "week" ? 7 : 30))}>Avanti</button></div>

      <div className={`planning-grid ${view}`}>{days.map((day) => { const items = byDay.get(day.key) || []; const summary = daySummary(items); return <button key={day.key} className={`planning-day ${day.inMonth === false ? "muted" : ""} ${selectedDate === day.key ? "selected" : ""}`} onClick={() => { setSelectedDate(day.key); setParams({ date: day.key }); if (view === "month") setView("day"); }}><strong>{formatDate(day.key)}</strong>{view === "month" ? <div className="planning-counters"><span className="dot open">{summary.open}</span><span className="dot danger">{summary.danger}</span><span className="dot done">{summary.done}</span></div> : <div className="planning-items">{items.slice(0, 6).map((i) => <span className={`planning-chip ${cls(i)}`} key={i.id}>{i.titolo}</span>)}</div>}</button>; })}</div>

      <div className="v4-split"><div className="panel"><div className="panel-header"><h3>Fasi del giorno · {formatDate(selectedDate)}</h3></div>{loading ? <p className="empty-text">Caricamento...</p> : selectedItems.length === 0 ? <p className="empty-text">Nessuna fase con deadline in questa giornata.</p> : <div className="v4-list">{selectedItems.map((item) => <div className={`v4-list-row ${cls(item)}`} key={item.id}><button className="v4-list-main" onClick={() => setSelected(item)}><strong>{item.titolo}</strong><span>{item.v4_progetti?.titolo || "Progetto"} · {item.reparti?.nome || "Reparto"}</span><small>{item.descrizione || ""}</small></button><span className={`status-pill ${cls(item)}`}>{status(item)}</span>{!isDone(item) && <button className="icon-action success" onClick={() => completePhase(item)}><CheckCircle2 size={18} />Completa</button>}</div>)}</div>}</div><div className="panel detail-panel"><div className="panel-header"><h3>Dettaglio fase</h3><CalendarDays size={20} /></div>{!selected ? <p className="empty-text">Seleziona una fase per vedere dettagli.</p> : <div className="detail-card"><h2>{selected.titolo}</h2><p>{selected.descrizione || "Nessuna descrizione"}</p><div className="mini-meta"><span>Progetto: {selected.v4_progetti?.titolo || "-"}</span><span>Reparto: {selected.reparti?.nome || "-"}</span><span>Assegnato a: {selected.assegnato_a || "-"}</span><span>Deadline: {formatDate(selected.deadline)}</span><span>Stato: {status(selected)}</span></div></div>}</div></div>
    </div>
  );
}

export default Tasks;

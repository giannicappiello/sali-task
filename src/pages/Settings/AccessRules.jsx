import { useCallback, useEffect, useMemo, useState } from "react";
import { Blocks, Building2, Plus, Save, Shield, UsersRound, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import SettingsWorkspaceNav from "./SettingsWorkspaceNav";
import { loadDepartmentMembers } from "./departmentMembers";
import "./access-control.css";

const LEVELS = [["lettura", "Consultazione"], ["scrittura", "Operatività"], ["amministrazione", "Gestione"]];
const AI_LEVELS = [["nessuno", "Nessun accesso"], ["analisi", "Solo analisi"], ["bozza", "Crea bozza"], ["conferma", "Esegui dopo conferma"]];
const EMPTY_ROLE = { nome: "", descrizione: "", amministratore_workspace: false, ambito_dati: "propri", livello_accesso: "lettura", livello_ai: "analisi" };
const EMPTY_DEPARTMENT = { nome: "", descrizione: "", attivo: true };

export default function AccessRules() {
  const [data, setData] = useState({ roles: [], departments: [], areas: [], modules: [], roleAreas: [], departmentAreas: [], departmentModules: [], roleModules: [] });
  const [mode, setMode] = useState("profili");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(EMPTY_ROLE);
  const [selectedAreas, setSelectedAreas] = useState([]);
  const [selectedModules, setSelectedModules] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const results = await Promise.all([
      supabase.from("ruoli").select("id,nome,descrizione,amministratore_workspace,ambito_dati,livello_accesso,livello_ai,accesso_come_beauty").order("nome"),
      supabase.from("reparti").select("id,nome,descrizione,attivo").order("nome"),
      supabase.from("workspace_aree").select("codice,nome,descrizione,attiva,ordine").eq("attiva", true).order("ordine"),
      supabase.from("workspace_moduli").select("codice,nome,area,attivo,assegnabile_reparto,configurabile_ruolo,ordine").eq("attivo", true).order("ordine"),
      supabase.from("workspace_ruoli_aree").select("ruolo_id,area_codice"),
      supabase.from("workspace_reparti_aree").select("reparto_id,area_codice"),
      supabase.from("reparti_moduli").select("reparto_id,modulo"),
      supabase.from("ruoli_moduli").select("ruolo_id,modulo,livello_accesso"),
    ]);
    const error = results.find((result) => result.error)?.error;
    if (error) setMessage({ type: "error", text: error.message });
    const [roles, departments, areas, modules, roleAreas, departmentAreas, departmentModules, roleModules] = results.map((result) => result.data || []);
    setData({ roles, departments, areas, modules, roleAreas, departmentAreas, departmentModules, roleModules });
    setSelectedId((current) => current || roles[0]?.id || "");
    setLoading(false);
  }, []);

  useEffect(() => {
    // Il caricamento iniziale sincronizza la schermata con il catalogo Supabase.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  const records = mode === "profili" ? data.roles : data.departments;
  const selected = records.find((item) => item.id === selectedId) || null;
  const isCreating = selectedId === "new";

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (isCreating) {
      setForm(mode === "profili" ? EMPTY_ROLE : EMPTY_DEPARTMENT);
      setSelectedAreas([]);
      setSelectedModules({});
      return;
    }
    if (!selected) return;
    setForm(selected);
    if (mode === "profili") {
      setSelectedAreas(data.roleAreas.filter((row) => row.ruolo_id === selected.id).map((row) => row.area_codice));
      setSelectedModules(Object.fromEntries(data.roleModules.filter((row) => row.ruolo_id === selected.id).map((row) => [row.modulo, row.livello_accesso])));
    } else {
      setSelectedAreas(data.departmentAreas.filter((row) => row.reparto_id === selected.id).map((row) => row.area_codice));
      setSelectedModules(Object.fromEntries(data.departmentModules.filter((row) => row.reparto_id === selected.id).map((row) => [row.modulo, "abilitato"])));
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [selected, isCreating, mode, data.roleAreas, data.departmentAreas, data.roleModules, data.departmentModules]);

  function selectMode(nextMode) {
    setMode(nextMode);
    const nextRecords = nextMode === "profili" ? data.roles : data.departments;
    setSelectedId(nextRecords[0]?.id || "");
  }

  function toggleArea(code) {
    setSelectedAreas((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  }

  async function save() {
    if (!form.nome?.trim()) return setMessage({ type: "error", text: "Inserisci il nome." });
    setSaving(true);
    const table = mode === "profili" ? "ruoli" : "reparti";
    const payload = mode === "profili" ? {
      nome: form.nome.trim(), descrizione: form.descrizione?.trim() || null, amministratore_workspace: form.amministratore_workspace === true,
      ambito_dati: form.ambito_dati || "propri", livello_accesso: form.livello_accesso || "lettura", livello_ai: form.livello_ai || "analisi", accesso_come_beauty: form.accesso_come_beauty === true,
    } : { nome: form.nome.trim(), descrizione: form.descrizione?.trim() || null, attivo: form.attivo !== false };
    const request = isCreating ? supabase.from(table).insert(payload).select("id").single() : supabase.from(table).update(payload).eq("id", selected.id).select("id").single();
    const { data: saved, error } = await request;
    if (error) { setSaving(false); return setMessage({ type: "error", text: error.message }); }
    const id = saved.id;
    const { error: writeError } = await supabase.rpc("workspace_replace_access_rules", {
      target_kind: mode, target_id: id, area_codes: mode === "reparti" ? selectedAreas : [], module_rules: selectedModules,
    });
    setSaving(false);
    if (writeError) return setMessage({ type: "error", text: writeError.message });
    setSelectedId(id);
    setMessage({ type: "success", text: `${mode === "profili" ? "Profilo" : "Reparto"} salvato.` });
    window.dispatchEvent(new CustomEvent("workspace:module-catalog-changed"));
    await loadData();
  }

  const visibleModules = useMemo(() => data.modules.filter((module) => mode === "profili" ? module.configurabile_ruolo !== false : module.assegnabile_reparto), [data.modules, mode]);

  if (loading) return <div className="access-loading">Caricamento regole di accesso...</div>;

  return <section className="access-page">
      <SettingsWorkspaceNav active="roles" />
    <div className="access-page-toolbar"><nav className="access-rule-tabs"><button type="button" className={mode === "profili" ? "active" : ""} onClick={() => selectMode("profili")}><Shield size={17}/>Profili e ruoli</button><button type="button" className={mode === "reparti" ? "active" : ""} onClick={() => selectMode("reparti")}><Building2 size={17}/>Reparti</button></nav><button type="button" className="primary-action" onClick={() => setSelectedId("new")}><Plus size={18}/>Nuovo {mode === "profili" ? "profilo" : "reparto"}</button></div>
    {message && <div className={`access-message ${message.type}`}>{message.text}<button type="button" onClick={() => setMessage(null)}><X size={16}/></button></div>}
    <div className="access-workspace rules">
      <aside className="access-users"><div className="access-list-heading"><h2>{mode === "profili" ? "Profili" : "Reparti"}</h2><span>{records.length}</span></div><div className="access-user-list" tabIndex={0} role="region" aria-label="Elenco selezionabile">{records.map((item) => <button type="button" key={item.id} className={selectedId === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><span className="access-avatar">{mode === "profili" ? <UsersRound size={17}/> : <Building2 size={17}/>}</span><span><strong>{item.nome}</strong><small>{mode === "profili" ? (item.amministratore_workspace ? "Amministratore" : LEVELS.find(([value]) => value === item.livello_accesso)?.[1]) : (item.attivo !== false ? "Attivo" : "Disattivo")}</small></span></button>)}</div></aside>
      <article className="access-editor"><div className="access-user-head"><span className="access-avatar large">{mode === "profili" ? <Shield size={20}/> : <Building2 size={20}/>}</span><div><h2>{isCreating ? `Nuovo ${mode === "profili" ? "profilo" : "reparto"}` : selected?.nome}</h2><p>{mode === "profili" ? "Definisce cosa può fare l’utente." : "Definisce quali dati e moduli appartengono al reparto."}</p></div></div><div className="access-editor-body">
        <div className="access-form-grid"><label>Nome<input value={form.nome || ""} onChange={(e) => setForm((v) => ({ ...v, nome: e.target.value }))}/></label>{mode === "profili" ? <><label>Livello predefinito<select value={form.livello_accesso || "lettura"} onChange={(e) => setForm((v) => ({ ...v, livello_accesso: e.target.value }))}>{LEVELS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Livello AI<select value={form.livello_ai || "analisi"} onChange={(e) => setForm((v) => ({ ...v, livello_ai: e.target.value }))}>{AI_LEVELS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Ambito dati<select value={form.ambito_dati || "propri"} onChange={(e) => setForm((v) => ({ ...v, ambito_dati: e.target.value }))}><option value="propri">Solo dati personali</option><option value="team">Reparti e persone collegate</option>{form.amministratore_workspace && <option value="tutti">Tutti i dati (amministratore)</option>}</select></label><label className="access-check"><input type="checkbox" checked={form.amministratore_workspace === true} onChange={(e) => setForm((v) => ({ ...v, amministratore_workspace: e.target.checked }))}/>Amministratore Workspace</label></> : <label className="access-check"><input type="checkbox" checked={form.attivo !== false} onChange={(e) => setForm((v) => ({ ...v, attivo: e.target.checked }))}/>Reparto attivo</label>}<label className="wide">Descrizione<textarea rows="2" value={form.descrizione || ""} onChange={(e) => setForm((v) => ({ ...v, descrizione: e.target.value }))}/></label></div>
        {mode === "reparti" && selected && !isCreating && <DepartmentMembers key={selected.id} departmentId={selected.id} />}
        {mode === "reparti" && <section className="access-rule-section"><div><Building2 size={18}/><span><strong>Aree autorizzate</strong><small>Le aree consentono le relative schermate, anche senza abilitare il modulo completo.</small></span></div><div className="access-choice-grid">{data.areas.map((area) => <label key={area.codice}><input type="checkbox" checked={selectedAreas.includes(area.codice)} onChange={() => toggleArea(area.codice)}/>{area.nome}</label>)}</div></section>}
        <section className="access-rule-section"><div><Blocks size={18}/><span><strong>Moduli e operatività</strong><small>{mode === "profili" ? "Il profilo stabilisce il livello operativo." : "Il reparto stabilisce quali moduli sono disponibili."}</small></span></div><p>BRAND DIRECT, DIRECT BtoB (CRM B2B) e DIRECT Online (CRM Online) si abilitano separatamente per reparto. Il livello del ruolo non abilita il modulo. CRM DIRECT è solo il contenitore dei canali autorizzati. Le eccezioni personali restano prioritarie.</p><div className="access-module-matrix">{visibleModules.map((module) => <div key={module.codice}><span><strong>{module.nome}</strong><small>{data.areas.find((area) => area.codice === module.area)?.nome || module.area}</small></span>{mode === "profili" ? <select value={selectedModules[module.codice] || form.livello_accesso || "lettura"} onChange={(e) => setSelectedModules((v) => ({ ...v, [module.codice]: e.target.value }))}>{LEVELS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select> : <label className="access-check"><input type="checkbox" checked={selectedModules[module.codice] === "abilitato"} onChange={(e) => setSelectedModules((v) => ({ ...v, [module.codice]: e.target.checked ? "abilitato" : "" }))}/>Abilitato</label>}</div>)}</div></section>
      </div><footer className="access-editor-footer"><span>Le eccezioni personali, se presenti, avranno priorità su queste regole.</span><button type="button" className="primary-action" onClick={save} disabled={saving}><Save size={17}/>{saving ? "Salvataggio..." : "Salva regole"}</button></footer></article>
    </div>
  </section>;
}

function DepartmentMembers({ departmentId }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    loadDepartmentMembers(supabase, departmentId).then((users) => {
      if (!cancelled) { setMembers(users); setLoading(false); }
    }).catch((failure) => {
      if (!cancelled) { setError(failure.message || "Impossibile caricare gli utenti del reparto."); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [departmentId, revision]);
  function refresh() {
    setLoading(true);
    setError("");
    setMembers([]);
    setRevision((value) => value + 1);
  }
  return <section className="department-members" aria-label="Utenti associati al reparto" aria-busy={loading}>
    <div className="department-members-heading"><h3><UsersRound size={18} />Utenti associati{!loading && !error ? ` (${members.length})` : ""}</h3><button type="button" onClick={refresh} disabled={loading}>Aggiorna elenco</button></div>
    {loading ? <p role="status">Caricamento utenti...</p> : error ? <p role="alert">{error}</p> : members.length ? <ul tabIndex={0} aria-label="Elenco utenti del reparto">{members.map((user) => <li key={user.id}><span><strong>{[user.nome, user.cognome].filter(Boolean).join(" ") || user.email || "Utente senza nome"}</strong><small>{user.ruoli?.nome || "Nessun ruolo"}{user.email ? ` · ${user.email}` : ""}</small></span><span className={user.attivo === false ? "member-inactive" : "member-active"}>{user.attivo === false ? "Disattivo" : "Attivo"}</span></li>)}</ul> : <p>Nessun utente associato a questo reparto.</p>}
  </section>;
}

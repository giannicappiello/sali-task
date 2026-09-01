import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Camera, CircleDollarSign, Coins, Database, Factory, Gauge, Globe2, Save, ShieldCheck, ShoppingCart, UserCheck, Users } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import useBackNavigation from "../../hooks/useBackNavigation";
import { supabase } from "../../lib/supabaseClient";
import InfoTooltip from "../../components/InfoTooltip";
import "./ai-settings.css";

const EMPTY_POLICY = Object.freeze({
  dati_interni: true,
  ricerca_web: false,
  ordini: false,
  progremes: false,
  pianificazione: false,
  applicazione_piani: false,
  riconoscimento_immagini: false,
  limite_richieste_mese: "",
  budget_mensile_reparto_usd: "",
  limite_spesa_utente_mese_usd: "",
  limite_documenti_giorno: "",
  massimo_pagine_documento: "",
  costo_massimo_operazione_usd: "",
});

const CAPABILITIES = [
  { key: "dati_interni", label: "Dati interni", description: "Consulta soltanto i dati già autorizzati nel Workspace.", icon: Database },
  { key: "ricerca_web", label: "Ricerca Web", description: "Cerca online e restituisce fonti cliccabili.", icon: Globe2 },
  { key: "ordini", label: "Ordini", description: "Analizza ordini PR e PH consentiti all’utente.", icon: ShoppingCart },
  { key: "progremes", label: "ProgreMES", description: "Consulta le informazioni rese disponibili da ProgreMES.", icon: Factory },
  { key: "pianificazione", label: "Pianificazione", description: "Crea simulazioni e proposte strutturate.", icon: CalendarClock },
  { key: "applicazione_piani", label: "Applica piani", description: "Consente l’approvazione e l’invio al connettore esterno.", icon: ShieldCheck },
  { key: "riconoscimento_immagini", label: "Immagini e documenti", description: "Abilita fotocamera, scansioni, PDF ed estrazione strutturata.", icon: Camera },
];

const AI_MODULE_CODES = new Set(["attivita", "prodotti", "documenti", "beauty_days", "ordini_pr", "ordini_ph", "ordini_private", "progremes"]);
const MODULE_OVERRIDE_OPTIONS = [{ value: "inherit", label: "Eredita dal reparto" }, { value: "allow", label: "Consentito" }, { value: "deny", label: "Bloccato" }];

const optionalNumber = (value) => value === "" || value === null || value === undefined ? null : Number(value);

export default function AISettings() {
  const goBack = useBackNavigation("/settings");
  const { hasPermission, profile } = useAuth();
  const canManage = hasPermission("settings.manage");
  const [departments, setDepartments] = useState([]);
  const [moduleDepartments, setModuleDepartments] = useState(new Set());
  const [policies, setPolicies] = useState({});
  const [users, setUsers] = useState([]);
  const [usageRows, setUsageRows] = useState([]);
  const [aiModules, setAiModules] = useState([]);
  const [modulePolicies, setModulePolicies] = useState({});
  const [userOverrides, setUserOverrides] = useState({});
  const [selectedUserId, setSelectedUserId] = useState("");
  const [effectiveAccess, setEffectiveAccess] = useState(null);
  const [checkingUser, setCheckingUser] = useState(false);
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      supabase.from("reparti").select("id,nome,descrizione,attivo").order("nome"),
      supabase.from("reparti_moduli").select("reparto_id").eq("modulo", "assistente_ai"),
      supabase.from("ai_reparti_capacita").select("*"),
      supabase.from("utenti").select("id,nome,cognome,email,attivo").order("cognome").order("nome"),
      supabase.from("ai_utilizzo_mensile").select("utente_id,mese,richieste,token_input,token_output,costo_usd,aggiornato_il").order("mese", { ascending: false }).limit(1000),
      supabase.from("workspace_moduli").select("codice,nome,ordine,attivo").eq("attivo", true).order("ordine"),
      supabase.from("ai_reparti_moduli").select("*"),
      supabase.from("ai_utenti_moduli").select("*"),
    ]).then(([departmentsResult, modulesResult, policiesResult, usersResult, usageResult, catalogResult, modulePoliciesResult, overridesResult]) => {
      if (!active) return;
      const error = departmentsResult.error || modulesResult.error || policiesResult.error || usersResult.error || usageResult.error || catalogResult.error || modulePoliciesResult.error || overridesResult.error;
      if (error) throw error;
      setDepartments((departmentsResult.data || []).filter((item) => item.attivo !== false));
      setModuleDepartments(new Set((modulesResult.data || []).map((item) => item.reparto_id)));
      setPolicies(Object.fromEntries((policiesResult.data || []).map((item) => [item.reparto_id, item])));
      setUsers((usersResult.data || []).filter((item) => item.attivo !== false));
      setUsageRows(usageResult.data || []);
      setAiModules((catalogResult.data || []).filter((item) => AI_MODULE_CODES.has(item.codice)));
      setModulePolicies(Object.fromEntries((modulePoliciesResult.data || []).map((item) => [`${item.reparto_id}:${item.modulo_codice}`, item])));
      setUserOverrides(Object.fromEntries((overridesResult.data || []).map((item) => [`${item.utente_id}:${item.modulo_codice}`, item])));
    }).catch((error) => {
      if (active) setMessage({ type: "error", text: error.message || "Impossibile caricare la configurazione AI." });
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const reportRows = useMemo(() => {
    const usageByUser = new Map(
      usageRows
        .filter((row) => String(row.mese || "").slice(0, 7) === reportMonth)
        .map((row) => [row.utente_id, row])
    );
    return users.map((user) => ({
      ...user,
      ...(usageByUser.get(user.id) || { richieste: 0, token_input: 0, token_output: 0, costo_usd: 0 }),
    })).sort((left, right) => Number(right.costo_usd || 0) - Number(left.costo_usd || 0));
  }, [reportMonth, usageRows, users]);

  const reportTotals = useMemo(() => reportRows.reduce((totals, row) => ({
    requests: totals.requests + Number(row.richieste || 0),
    tokens: totals.tokens + Number(row.token_input || 0) + Number(row.token_output || 0),
    cost: totals.cost + Number(row.costo_usd || 0),
  }), { requests: 0, tokens: 0, cost: 0 }), [reportRows]);

  const formatTokens = (value) => new Intl.NumberFormat("it-IT").format(Number(value || 0));
  const formatUsd = (value) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(Number(value || 0));

  function policyFor(departmentId) {
    return { ...EMPTY_POLICY, ...(policies[departmentId] || {}) };
  }

  function updatePolicy(departmentId, key, value) {
    setPolicies((current) => ({
      ...current,
      [departmentId]: { ...EMPTY_POLICY, ...(current[departmentId] || {}), reparto_id: departmentId, [key]: value },
    }));
  }

  function modulePolicyFor(departmentId, moduleCode) {
    return { consentito: false, riconoscimento_immagini: false, ...(modulePolicies[`${departmentId}:${moduleCode}`] || {}) };
  }

  function updateModulePolicy(departmentId, moduleCode, key, value) {
    const compoundKey = `${departmentId}:${moduleCode}`;
    setModulePolicies((current) => ({
      ...current,
      [compoundKey]: { ...modulePolicyFor(departmentId, moduleCode), reparto_id: departmentId, modulo_codice: moduleCode, [key]: value },
    }));
  }

  async function setDepartmentEnabled(departmentId, enabled) {
    if (!canManage) return;
    const operation = `module:${departmentId}`;
    setSaving(operation);
    setMessage(null);
    const result = enabled
      ? await supabase.from("reparti_moduli").upsert({ reparto_id: departmentId, modulo: "assistente_ai" }, { onConflict: "reparto_id,modulo" })
      : await supabase.from("reparti_moduli").delete().eq("reparto_id", departmentId).eq("modulo", "assistente_ai");
    setSaving("");
    if (result.error) {
      setMessage({ type: "error", text: result.error.message || "Impossibile modificare l’accesso al modulo AI." });
      return;
    }
    setModuleDepartments((current) => {
      const next = new Set(current);
      if (enabled) next.add(departmentId);
      else next.delete(departmentId);
      return next;
    });
    setMessage({ type: "success", text: enabled ? "Modulo AI attivato per il reparto." : "Modulo AI disattivato per il reparto." });
  }

  async function saveDepartment(departmentId) {
    if (!canManage) return;
    setSaving(departmentId);
    setMessage(null);
    const policy = policyFor(departmentId);
    const payload = {
      reparto_id: departmentId,
      dati_interni: policy.dati_interni === true,
      ricerca_web: policy.ricerca_web === true,
      ordini: policy.ordini === true,
      progremes: policy.progremes === true,
      pianificazione: policy.pianificazione === true,
      applicazione_piani: policy.applicazione_piani === true,
      riconoscimento_immagini: policy.riconoscimento_immagini === true,
      limite_richieste_mese: optionalNumber(policy.limite_richieste_mese),
      budget_mensile_reparto_usd: optionalNumber(policy.budget_mensile_reparto_usd),
      limite_spesa_utente_mese_usd: optionalNumber(policy.limite_spesa_utente_mese_usd),
      limite_documenti_giorno: optionalNumber(policy.limite_documenti_giorno),
      massimo_pagine_documento: optionalNumber(policy.massimo_pagine_documento),
      costo_massimo_operazione_usd: optionalNumber(policy.costo_massimo_operazione_usd),
      aggiornato_da: profile?.id || null,
      aggiornato_il: new Date().toISOString(),
    };
    const modulePayload = aiModules.map((module) => ({
      consentito: modulePolicyFor(departmentId, module.codice).consentito === true,
      riconoscimento_immagini: modulePolicyFor(departmentId, module.codice).riconoscimento_immagini === true,
      reparto_id: departmentId,
      modulo_codice: module.codice,
      aggiornato_da: profile?.id || null,
      aggiornato_il: new Date().toISOString(),
    }));
    const [policyResult, modulesResult] = await Promise.all([
      supabase.from("ai_reparti_capacita").upsert(payload, { onConflict: "reparto_id" }).select().single(),
      supabase.from("ai_reparti_moduli").upsert(modulePayload, { onConflict: "reparto_id,modulo_codice" }).select(),
    ]);
    setSaving("");
    const { data, error } = policyResult;
    if (!error && modulesResult.error) {
      setMessage({ type: "error", text: modulesResult.error.message });
      return;
    }
    if (error) {
      setMessage({ type: "error", text: error.message });
      return;
    }
    setPolicies((current) => ({ ...current, [departmentId]: data }));
    setModulePolicies((current) => ({ ...current, ...Object.fromEntries((modulesResult.data || []).map((item) => [`${item.reparto_id}:${item.modulo_codice}`, item])) }));
    setMessage({ type: "success", text: "Capacità, moduli e limiti AI salvati." });
  }

  async function verifyUser(userId = selectedUserId) {
    if (!userId) {
      setEffectiveAccess(null);
      return;
    }
    setCheckingUser(true);
    const { data, error } = await supabase.rpc("admin_ai_effective_access", { target_user_id: userId });
    setCheckingUser(false);
    if (error || data?.error) {
      setMessage({ type: "error", text: error?.message || data?.error });
      return;
    }
    setEffectiveAccess(data);
  }

  async function saveUserOverride(moduleCode, allowed, visionValue) {
    if (!selectedUserId) return;
    const key = `${selectedUserId}:${moduleCode}`;
    setSaving(`override:${moduleCode}`);
    const payload = {
      utente_id: selectedUserId,
      modulo_codice: moduleCode,
      consentito: allowed,
      riconoscimento_immagini: visionValue,
      aggiornato_da: profile?.id || null,
      aggiornato_il: new Date().toISOString(),
    };
    const { data, error } = await supabase.from("ai_utenti_moduli").upsert(payload, { onConflict: "utente_id,modulo_codice" }).select().single();
    setSaving("");
    if (error) return setMessage({ type: "error", text: error.message });
    setUserOverrides((current) => ({ ...current, [key]: data }));
    await verifyUser(selectedUserId);
    setMessage({ type: "success", text: "Eccezione utente aggiornata." });
  }

  if (!canManage) {
    return <section className="ai-settings-page"><div className="ai-settings-denied"><ShieldCheck size={42} /><h1>Accesso riservato</h1><p>La configurazione dell’AI è disponibile soltanto agli amministratori del Workspace.</p><button type="button" onClick={goBack}>Torna alle impostazioni</button></div></section>;
  }

  return (
    <section className="ai-settings-page">
      {message && <div className={`ai-settings-message ${message.type}`}>{message.text}</div>}
      {loading ? <div className="ai-settings-loading">Caricamento configurazione...</div> : (
        <>
        <section className="ai-cost-report" aria-labelledby="ai-cost-report-title">
          <div className="ai-cost-report-heading">
            <div><span>CONTROLLO COSTI</span><h2 id="ai-cost-report-title">Rendicontazione AI per utente</h2><p>Costi effettivi comunicati da AI Gateway, espressi in dollari USA.</p></div>
            <label><CalendarClock size={18} /><span>Mese</span><input type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} /></label>
          </div>
          <div className="ai-cost-kpis">
            <article><CircleDollarSign size={23} /><span>Spesa totale<InfoTooltip label="Spesa totale" text="Somma dei costi effettivi in USD comunicati da AI Gateway per il mese selezionato." /></span><strong>{formatUsd(reportTotals.cost)}</strong></article>
            <article><Gauge size={23} /><span>Richieste<InfoTooltip label="Richieste" text="Numero totale di chiamate AI rendicontate nel mese selezionato." /></span><strong>{formatTokens(reportTotals.requests)}</strong></article>
            <article><Coins size={23} /><span>Token complessivi<InfoTooltip label="Token complessivi" text="Somma dei token di input e output consumati dalle richieste AI del mese selezionato." /></span><strong>{formatTokens(reportTotals.tokens)}</strong></article>
            <article><Users size={23} /><span>Utenti rendicontati</span><strong>{reportRows.filter((row) => Number(row.richieste || 0) > 0).length}</strong></article>
          </div>
          <div className="ai-cost-table-wrap">
            <table className="ai-cost-table">
              <thead><tr><th>Utente</th><th>Richieste</th><th>Token input</th><th>Token output</th><th>Spesa</th></tr></thead>
              <tbody>
                {reportRows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{[row.nome, row.cognome].filter(Boolean).join(" ") || row.email}</strong><small>{row.email}</small></td>
                    <td>{formatTokens(row.richieste)}</td>
                    <td>{formatTokens(row.token_input)}</td>
                    <td>{formatTokens(row.token_output)}</td>
                    <td><strong>{formatUsd(row.costo_usd)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="ai-access-check" aria-labelledby="ai-access-check-title">
          <div className="ai-access-check-heading">
            <div><span>CONTROLLO AUTORIZZAZIONI</span><h2 id="ai-access-check-title">Verifica accesso utente</h2><p>Mostra il risultato effettivo di modulo, ruolo, reparto e regole AI.</p></div>
            <label><UserCheck size={19} /><select value={selectedUserId} onChange={(event) => { setSelectedUserId(event.target.value); void verifyUser(event.target.value); }}><option value="">Seleziona un utente</option>{users.map((user) => <option key={user.id} value={user.id}>{[user.nome, user.cognome].filter(Boolean).join(" ") || user.email}</option>)}</select></label>
          </div>
          {checkingUser ? <div className="ai-settings-loading">Calcolo autorizzazioni...</div> : null}
          {effectiveAccess ? <>
            <div className="ai-effective-summary">
              <span className={effectiveAccess.module_access ? "allowed" : "blocked"}>Modulo AI: {effectiveAccess.module_access ? "attivo" : "non disponibile"}</span>
              <span className={effectiveAccess.vision ? "allowed" : "blocked"}>Immagini: {effectiveAccess.vision ? "abilitate" : "disabilitate"}</span>
              <span>Dati interni: {effectiveAccess.internal_data ? "sì" : "no"}</span>
              <span>Web: {effectiveAccess.web_search ? "sì" : "no"}</span>
            </div>
            <div className="ai-module-table-wrap"><table className="ai-module-table"><thead><tr><th>Modulo</th><th>Permesso gestionale</th><th>Accesso AI effettivo</th><th>Immagini</th><th>Eccezione personale</th><th></th></tr></thead><tbody>
              {(effectiveAccess.modules || []).map((module) => {
                const override = userOverrides[`${selectedUserId}:${module.code}`] || { consentito: null, riconoscimento_immagini: null };
                return <tr key={module.code}><td><strong>{module.name}</strong></td><td>{module.business_level}</td><td><span className={module.allowed ? "ai-level ai-level-conferma" : "ai-level ai-level-nessuno"}>{module.allowed ? "Consentito" : "Bloccato"}</span></td><td>{module.vision ? "Consentite" : "Bloccate"}</td><td><div className="ai-override-controls"><select value={override.consentito === null || override.consentito === undefined ? "inherit" : override.consentito ? "allow" : "deny"} onChange={(event) => setUserOverrides((current) => ({ ...current, [`${selectedUserId}:${module.code}`]: { ...override, consentito: event.target.value === "inherit" ? null : event.target.value === "allow" } }))}>{MODULE_OVERRIDE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><select value={override.riconoscimento_immagini === null || override.riconoscimento_immagini === undefined ? "inherit" : override.riconoscimento_immagini ? "allow" : "deny"} onChange={(event) => setUserOverrides((current) => ({ ...current, [`${selectedUserId}:${module.code}`]: { ...override, riconoscimento_immagini: event.target.value === "inherit" ? null : event.target.value === "allow" } }))}><option value="inherit">Immagini: eredita</option><option value="allow">Immagini: consenti</option><option value="deny">Immagini: blocca</option></select></div></td><td><button type="button" disabled={saving === `override:${module.code}`} onClick={() => saveUserOverride(module.code, (userOverrides[`${selectedUserId}:${module.code}`] || override).consentito ?? null, (userOverrides[`${selectedUserId}:${module.code}`] || override).riconoscimento_immagini ?? null)}><Save size={16} />Salva</button></td></tr>
              })}
            </tbody></table></div>
          </> : <div className="ai-access-empty"><UserCheck size={34} /><p>Seleziona un utente per verificare autorizzazioni ed eventuali eccezioni.</p></div>}
        </section>
        <div className="ai-department-list">
          {departments.map((department) => {
            const enabled = moduleDepartments.has(department.id);
            const policy = policyFor(department.id);
            return (
              <article key={department.id} className={`ai-department-card ${enabled ? "enabled" : "disabled"}`}>
                <div className="ai-department-heading">
                  <div><h2>{department.nome}</h2><p>{enabled ? "Modulo Assistente AI assegnato" : "Modulo Assistente AI non assegnato"}</p></div>
                  <div className="ai-department-access">
                    <span>{enabled ? "Accesso attivo" : "Nessun accesso"}</span>
                    <button type="button" disabled={saving === `module:${department.id}`} onClick={() => setDepartmentEnabled(department.id, !enabled)}>
                      {saving === `module:${department.id}` ? "Aggiornamento..." : enabled ? "Disattiva modulo AI" : "Attiva modulo AI"}
                    </button>
                  </div>
                </div>
                <div className="ai-capability-grid">
                  {CAPABILITIES.map(({ key, label, description, icon: Icon }) => (
                    <label key={key} className={policy[key] ? "selected" : ""}>
                      <input type="checkbox" disabled={!enabled} checked={policy[key] === true} onChange={(event) => updatePolicy(department.id, key, event.target.checked)} />
                      <Icon size={20} />
                      <span><strong>{label}</strong><small>{description}</small></span>
                    </label>
                  ))}
                </div>
                <div className="ai-department-modules">
                  <div><h3>Autorizzazioni per modulo</h3><p>Qui si decide solo se il modulo è consentito o bloccato. Il livello operativo AI dipende dal ruolo.</p></div>
                  <div className="ai-module-table-wrap"><table className="ai-module-table"><thead><tr><th>Modulo</th><th>Accesso AI</th><th>Riconoscimento immagini</th></tr></thead><tbody>
                    {aiModules.map((module) => {
                      const modulePolicy = modulePolicyFor(department.id, module.codice);
                      return <tr key={module.codice}><td><strong>{module.nome}</strong></td><td><label className="ai-inline-switch"><input type="checkbox" disabled={!enabled} checked={modulePolicy.consentito === true} onChange={(event) => updateModulePolicy(department.id, module.codice, "consentito", event.target.checked)} /><span>{modulePolicy.consentito ? "Consentito" : "Bloccato"}</span></label></td><td><label className="ai-inline-switch"><input type="checkbox" disabled={!enabled || !policy.riconoscimento_immagini || !modulePolicy.consentito} checked={modulePolicy.riconoscimento_immagini === true} onChange={(event) => updateModulePolicy(department.id, module.codice, "riconoscimento_immagini", event.target.checked)} /><span>{modulePolicy.riconoscimento_immagini ? "Consentito" : "Bloccato"}</span></label></td></tr>
                    })}
                  </tbody></table></div>
                </div>
                <div className="ai-department-footer">
                  <div className="ai-limit-grid">
                    <label><span>Richieste mensili</span><input type="number" min="1" disabled={!enabled} value={policy.limite_richieste_mese ?? ""} onChange={(event) => updatePolicy(department.id, "limite_richieste_mese", event.target.value)} placeholder="Nessun limite" /></label>
                    <label><span>Budget reparto USD</span><input type="number" min="0.01" step="0.01" disabled={!enabled} value={policy.budget_mensile_reparto_usd ?? ""} onChange={(event) => updatePolicy(department.id, "budget_mensile_reparto_usd", event.target.value)} placeholder="Nessun limite" /></label>
                    <label><span>Limite utente USD</span><input type="number" min="0.01" step="0.01" disabled={!enabled} value={policy.limite_spesa_utente_mese_usd ?? ""} onChange={(event) => updatePolicy(department.id, "limite_spesa_utente_mese_usd", event.target.value)} placeholder="Nessun limite" /></label>
                    <label><span>Documenti al giorno</span><input type="number" min="1" disabled={!enabled} value={policy.limite_documenti_giorno ?? ""} onChange={(event) => updatePolicy(department.id, "limite_documenti_giorno", event.target.value)} placeholder="Nessun limite" /></label>
                    <label><span>Pagine per documento</span><input type="number" min="1" disabled={!enabled} value={policy.massimo_pagine_documento ?? ""} onChange={(event) => updatePolicy(department.id, "massimo_pagine_documento", event.target.value)} placeholder="Nessun limite" /></label>
                    <label><span>Costo massimo operazione</span><input type="number" min="0.001" step="0.001" disabled={!enabled} value={policy.costo_massimo_operazione_usd ?? ""} onChange={(event) => updatePolicy(department.id, "costo_massimo_operazione_usd", event.target.value)} placeholder="Nessun limite" /></label>
                  </div>
                  <button type="button" disabled={!enabled || saving === department.id} onClick={() => saveDepartment(department.id)}><Save size={18} />{saving === department.id ? "Salvataggio..." : "Salva capacità"}</button>
                </div>
              </article>
            );
          })}
        </div>
        </>
      )}
    </section>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, KeyRound, Plus, Save, Search, ShieldCheck, UserRound, UsersRound, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import "./access-control.css";

const EMPTY_USER = { nome: "", cognome: "", email: "", telefono: "", password: "", ruolo_id: "", reparto_ids: [], responsabile_utente_id: "", mexal_agente_id: "", beauty_mexal_agente_id: "", customer_code: "", attivo: true };
const AI_ACCESS_OPTIONS = [["inherit", "Eredita dal reparto"], ["allow", "Consentito"], ["deny", "Bloccato"]];

function fullName(user) {
  return [user?.nome, user?.cognome].filter(Boolean).join(" ") || user?.email || "Nuovo utente";
}

function initials(user) {
  return `${user?.nome?.[0] || ""}${user?.cognome?.[0] || ""}`.toUpperCase() || "NU";
}

function managedUserState(value) {
  return {
    nome: value.nome || "", cognome: value.cognome || "", email: value.email || "", telefono: value.telefono || "",
    ruolo_id: value.ruolo_id || "", reparto_id: value.reparto_ids?.[0] || "", responsabile_utente_id: value.responsabile_utente_id || "",
    customer_code: value.customer_code || "", attivo: value.attivo !== false,
  };
}

async function edgeErrorMessage(error, response) {
  if (response?.error) return response.error;
  try {
    const payload = await error?.context?.clone?.().json();
    if (payload?.error) return payload.error;
  } catch {
    // La risposta può non avere un body JSON; usa il messaggio SDK come fallback.
  }
  return error?.message || "Salvataggio non riuscito.";
}

export default function AccessUsers() {
  const { profile, isAdminUser, reloadProfile } = useAuth();
  const [data, setData] = useState({ users: [], roles: [], departments: [], userDepartments: [], agents: [], integrations: [], exceptions: [], aiOverrides: [], modules: [], areas: [], screens: [], customers: [], customerLinks: [] });
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(EMPTY_USER);
  const [savedManagedForm, setSavedManagedForm] = useState(EMPTY_USER);
  const [tab, setTab] = useState("dati");
  const [search, setSearch] = useState("");
  const [exceptionDraft, setExceptionDraft] = useState({ ambito: "modulo", codice: "", decisione: "consenti", livello_accesso: "", motivazione: "", valida_fino_a: "" });
  const [userExceptions, setUserExceptions] = useState([]);
  const [aiLevels, setAiLevels] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const results = await Promise.all([
      supabase.from("utenti").select("id,auth_user_id,nome,cognome,email,telefono,attivo,reparto_id,ruolo_id,responsabile_utente_id,ruoli(id,nome,amministratore_workspace,livello_ai)").order("nome"),
      supabase.from("ruoli").select("id,nome,amministratore_workspace,ambito_dati,livello_accesso,livello_ai").order("nome"),
      supabase.from("reparti").select("id,nome,attivo").order("nome"),
      supabase.from("utenti_reparti").select("utente_id,reparto_id"),
      supabase.from("mexal_agenti").select("id,codice,nome,cognome,attivo_mexal,workspace_utente_id,responsabile_utente_id").order("cognome"),
      supabase.from("integrazioni_utenti").select("utente_id,modulo,mexal_agente_id").eq("modulo", "report_giornate"),
      supabase.from("workspace_eccezioni_utente").select("*").order("creata_il"),
      supabase.from("ai_utenti_moduli").select("utente_id,modulo_codice,consentito,riconoscimento_immagini"),
      supabase.from("workspace_moduli").select("codice,nome,area,attivo,ordine").eq("attivo", true).order("ordine"),
      supabase.from("workspace_aree").select("codice,nome,attiva,ordine").eq("attiva", true).order("ordine"),
      supabase.from("workspace_schermate").select("codice,nome,attiva,ordine").eq("attiva", true).order("ordine"),
      supabase.from("ordini_clienti_cache").select("codice_cliente,ragione_sociale,partita_iva").eq("attivo_mexal", true).order("ragione_sociale").limit(10000),
      supabase.from("workspace_customer_user_links").select("user_id,customer_code"),
    ]);
    const firstError = results.find((result) => result.error)?.error;
    if (firstError) setMessage({ type: "error", text: firstError.message });
    const [users, roles, departments, userDepartments, agents, integrations, exceptions, aiOverrides, modules, areas, screens, customers, customerLinks] = results.map((result) => result.data || []);
    setData({ users, roles, departments, userDepartments, agents, integrations, exceptions, aiOverrides, modules, areas, screens, customers, customerLinks });
    setSelectedId((current) => current || users[0]?.id || "");
    setLoading(false);
  }, []);

  useEffect(() => {
    // Il caricamento iniziale sincronizza la schermata con il catalogo Supabase.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  const selectedUser = data.users.find((user) => user.id === selectedId) || null;
  const isCreating = selectedId === "new";

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (isCreating) {
      setForm(EMPTY_USER);
      setSavedManagedForm(EMPTY_USER);
      setUserExceptions([]);
      setAiLevels({});
      return;
    }
    if (!selectedUser) return;
    const linkedAgent = data.agents.find((agent) => agent.workspace_utente_id === selectedUser.id);
    const beauty = data.integrations.find((item) => item.utente_id === selectedUser.id);
    const customerLink = data.customerLinks.find((item) => item.user_id === selectedUser.id);
    const departmentIds = data.userDepartments.filter((row) => row.utente_id === selectedUser.id).map((row) => row.reparto_id);
    if (selectedUser.reparto_id && !departmentIds.includes(selectedUser.reparto_id)) departmentIds.unshift(selectedUser.reparto_id);
    const nextForm = {
      nome: selectedUser.nome || "", cognome: selectedUser.cognome || "", email: selectedUser.email || "", telefono: selectedUser.telefono || "", password: "",
      ruolo_id: selectedUser.ruolo_id || "", reparto_ids: [...new Set(departmentIds)], responsabile_utente_id: selectedUser.responsabile_utente_id || linkedAgent?.responsabile_utente_id || "",
      mexal_agente_id: linkedAgent?.id || "", beauty_mexal_agente_id: beauty?.mexal_agente_id || "", customer_code: customerLink?.customer_code || "", attivo: selectedUser.attivo !== false,
    };
    setForm(nextForm);
    setSavedManagedForm(nextForm);
    setUserExceptions(data.exceptions.filter((item) => item.utente_id === selectedUser.id));
    setAiLevels(Object.fromEntries(data.aiOverrides.filter((item) => item.utente_id === selectedUser.id).map((item) => [item.modulo_codice, { consentito: item.consentito, riconoscimento_immagini: item.riconoscimento_immagini }])));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [selectedUser, isCreating, data.userDepartments, data.agents, data.integrations, data.customerLinks, data.exceptions, data.aiOverrides]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.users.filter((user) => !query || `${fullName(user)} ${user.email || ""} ${user.ruoli?.nome || ""}`.toLowerCase().includes(query));
  }, [data.users, search]);

  const selectedRole = data.roles.find((role) => role.id === form.ruolo_id);
  const responsiblePeople = data.users.filter((user) => user.id !== selectedId && user.attivo !== false);
  const linkedPeople = data.users.filter((user) => user.responsabile_utente_id === selectedId);
  const targetOptions = useMemo(() => {
    if (exceptionDraft.ambito === "area") return data.areas.map((item) => [item.codice, item.nome]);
    if (exceptionDraft.ambito === "schermata") return data.screens.map((item) => [item.codice, item.nome]);
    if (exceptionDraft.ambito === "permesso") return [["settings.manage", "Gestione impostazioni"], ["users.manage", "Gestione utenti"], ["integrations.configure", "Configurazione integrazioni"], ["projects.write", "Gestione progetti"], ["tasks.write", "Gestione attività"]];
    return data.modules.map((item) => [item.codice, item.nome]);
  }, [data, exceptionDraft.ambito]);

  function addException() {
    if (!exceptionDraft.codice) return setMessage({ type: "error", text: "Seleziona l'elemento a cui applicare l'eccezione." });
    const row = { ...exceptionDraft, id: `new:${crypto.randomUUID()}`, utente_id: selectedId, valida_fino_a: exceptionDraft.valida_fino_a ? new Date(exceptionDraft.valida_fino_a).toISOString() : null };
    setUserExceptions((current) => [...current.filter((item) => !(item.ambito === row.ambito && item.codice === row.codice)), row]);
    setExceptionDraft({ ambito: "modulo", codice: "", decisione: "consenti", livello_accesso: "", motivazione: "", valida_fino_a: "" });
  }

  async function sendPasswordReset() {
    if (!form.email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(form.email, { redirectTo: `${window.location.origin}/login` });
    setMessage(error ? { type: "error", text: error.message } : { type: "success", text: "Link per il cambio password inviato." });
  }

  async function saveUser() {
    if (!isAdminUser) return setMessage({ type: "error", text: "Operazione riservata all'amministratore." });
    const managedChanged = isCreating || form.password || JSON.stringify(managedUserState(form)) !== JSON.stringify(managedUserState(savedManagedForm));
    if (managedChanged && (!form.nome.trim() || !form.cognome.trim() || !form.email.trim())) return setMessage({ type: "error", text: "Nome, cognome ed email sono obbligatori quando modifichi i dati o l'organizzazione dell'utente." });
    if (isCreating && form.password.length < 8) return setMessage({ type: "error", text: "Per il nuovo utente inserisci una password di almeno 8 caratteri." });
    const customerRole = /(^|\s)(cliente|customer)(\s|$)/i.test(selectedRole?.nome || "");
    if (customerRole && !form.customer_code) return setMessage({ type: "error", text: "Per un utente Cliente è obbligatorio selezionare l'anagrafica cliente associata." });
    setSaving(true);
    setMessage(null);
    let response = null;
    if (managedChanged) {
      const action = isCreating ? "create" : "update";
      const primaryDepartment = form.reparto_ids[0] || null;
      const invocation = await supabase.functions.invoke("admin-manage-user", { body: {
        action, id: selectedUser?.id, auth_user_id: selectedUser?.auth_user_id, nome: form.nome.trim(), cognome: form.cognome.trim(), email: form.email.trim(), telefono: form.telefono.trim(),
        password: form.password, ruolo_id: form.ruolo_id || null, reparto_id: primaryDepartment, responsabile_utente_id: form.responsabile_utente_id || null, customer_code: form.customer_code || null, attivo: form.attivo,
      } });
      response = invocation.data;
      if (invocation.error || response?.error) {
        setSaving(false);
        return setMessage({ type: "error", text: await edgeErrorMessage(invocation.error, response) });
      }
    }
    const userId = selectedUser?.id || response?.user_id;
    const operations = [];
    operations.push(supabase.from("utenti_reparti").delete().eq("utente_id", userId));
    operations.push(supabase.from("mexal_agenti").update({ workspace_utente_id: null, responsabile_utente_id: null }).eq("workspace_utente_id", userId));
    operations.push(supabase.from("workspace_eccezioni_utente").delete().eq("utente_id", userId));
    operations.push(supabase.from("ai_utenti_moduli").delete().eq("utente_id", userId));
    const baseResults = await Promise.all(operations);
    const baseError = baseResults.find((result) => result.error)?.error;
    if (baseError) { setSaving(false); return setMessage({ type: "error", text: baseError.message }); }
    const inserts = [];
    if (form.reparto_ids.length) inserts.push(supabase.from("utenti_reparti").insert(form.reparto_ids.map((reparto_id) => ({ utente_id: userId, reparto_id }))));
    if (form.mexal_agente_id) inserts.push(supabase.from("mexal_agenti").update({ workspace_utente_id: userId, responsabile_utente_id: form.responsabile_utente_id || null }).eq("id", form.mexal_agente_id));
    if (form.beauty_mexal_agente_id) inserts.push(supabase.from("integrazioni_utenti").upsert({ utente_id: userId, modulo: "report_giornate", mexal_agente_id: form.beauty_mexal_agente_id }, { onConflict: "utente_id,modulo" }));
    if (userExceptions.length) inserts.push(supabase.from("workspace_eccezioni_utente").insert(userExceptions.map(({ ambito, codice, decisione, livello_accesso, motivazione, valida_fino_a }) => ({ utente_id: userId, ambito, codice, decisione, livello_accesso: livello_accesso || null, motivazione: motivazione || null, valida_fino_a: valida_fino_a || null, creata_da: profile?.id || null }))));
    const aiRows = Object.entries(aiLevels).filter(([, value]) => value?.consentito !== null && value?.consentito !== undefined || value?.riconoscimento_immagini !== null && value?.riconoscimento_immagini !== undefined).map(([modulo_codice, value]) => ({ utente_id: userId, modulo_codice, consentito: value.consentito ?? null, riconoscimento_immagini: value.riconoscimento_immagini ?? null, aggiornato_da: profile?.id || null }));
    if (aiRows.length) inserts.push(supabase.from("ai_utenti_moduli").insert(aiRows));
    const insertResults = await Promise.all(inserts);
    const insertError = insertResults.find((result) => result.error)?.error;
    setSaving(false);
    if (insertError) return setMessage({ type: "error", text: insertError.message });
    setMessage({ type: "success", text: "Configurazione utente salvata." });
    setSelectedId(userId);
    await loadData();
    if (userId === profile?.id) await reloadProfile();
  }

  if (loading) return <div className="access-loading">Caricamento utenti e autorizzazioni...</div>;

  return (
    <section className="access-page">
      <div className="access-page-actions"><button type="button" className="primary-action" onClick={() => { setSelectedId("new"); setTab("dati"); }}><Plus size={18}/>Nuovo utente</button></div>
      {message && <div className={`access-message ${message.type}`}>{message.text}<button type="button" onClick={() => setMessage(null)}><X size={16}/></button></div>}
      <div className="access-workspace">
        <aside className="access-users"><div className="access-list-heading"><h2>Persone</h2><span>{data.users.length}</span></div><label className="access-search"><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca utente..."/></label><div className="access-user-list">{filteredUsers.map((user) => <button type="button" key={user.id} className={selectedId === user.id ? "active" : ""} onClick={() => setSelectedId(user.id)}><span className="access-avatar">{initials(user)}</span><span><strong>{fullName(user)}</strong><small>{user.ruoli?.nome || "Nessun ruolo"}</small></span><i className={user.attivo !== false ? "online" : "offline"}/></button>)}</div></aside>
        <article className="access-editor">
          <div className="access-user-head"><span className="access-avatar large">{initials(isCreating ? form : selectedUser)}</span><div><h2>{isCreating ? "Nuovo utente" : fullName(selectedUser)}</h2><p>{selectedRole?.nome || "Profilo non assegnato"}</p></div>{selectedRole?.amministratore_workspace && <span className="access-admin"><ShieldCheck size={16}/>Accesso completo</span>}</div>
          <nav className="access-tabs" aria-label="Configurazione utente">{[["dati","Dati",UserRound],["organizzazione","Organizzazione",UsersRound],["accessi","Accessi",ShieldCheck],["ai","AI",Bot]].map(([code,label,Icon]) => <button type="button" key={code} className={tab === code ? "active" : ""} onClick={() => setTab(code)}><Icon size={16}/>{label}</button>)}</nav>
          <div className="access-editor-body">
            {tab === "dati" && <div className="access-form-grid"><label>Nome<input value={form.nome} onChange={(e) => setForm((v) => ({ ...v, nome: e.target.value }))}/></label><label>Cognome<input value={form.cognome} onChange={(e) => setForm((v) => ({ ...v, cognome: e.target.value }))}/></label><label>Email<input type="email" value={form.email} onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))}/></label><label>Telefono<input value={form.telefono} onChange={(e) => setForm((v) => ({ ...v, telefono: e.target.value }))}/></label><label className="wide">{isCreating ? "Password iniziale" : "Nuova password (lascia vuoto per non cambiarla)"}<input type="password" minLength="8" value={form.password} onChange={(e) => setForm((v) => ({ ...v, password: e.target.value }))}/></label><div className="access-security-actions wide"><button type="button" onClick={sendPasswordReset} disabled={!form.email || isCreating}><KeyRound size={16}/>Invia link cambio password</button><label className="access-check"><input type="checkbox" checked={form.attivo} onChange={(e) => setForm((v) => ({ ...v, attivo: e.target.checked }))}/>Account attivo</label></div></div>}
            {tab === "organizzazione" && <><div className="access-form-grid"><label>Ruolo<select value={form.ruolo_id} onChange={(e) => setForm((v) => ({ ...v, ruolo_id: e.target.value }))}><option value="">Nessun ruolo</option>{data.roles.map((role) => <option key={role.id} value={role.id}>{role.nome}</option>)}</select></label><label>Responsabile collegato<select value={form.responsabile_utente_id} onChange={(e) => setForm((v) => ({ ...v, responsabile_utente_id: e.target.value }))}><option value="">Nessun responsabile</option>{responsiblePeople.map((user) => <option key={user.id} value={user.id}>{fullName(user)}</option>)}</select></label><label className="wide">Cliente associato in anagrafica<input list="workspace-customer-options" value={form.customer_code} onChange={(e) => setForm((v) => ({ ...v, customer_code: e.target.value.trim() }))} placeholder="Cerca o inserisci il codice cliente..."/><datalist id="workspace-customer-options">{data.customers.map((customer) => <option key={customer.codice_cliente} value={customer.codice_cliente}>{customer.ragione_sociale} · {customer.partita_iva || "P. IVA non disponibile"}</option>)}</datalist><small>Obbligatorio per il ruolo Cliente. L'utente vedrà esclusivamente dati, ordini, documenti e fatture di questa anagrafica.</small></label><fieldset className="wide"><legend>Reparti associati</legend><div className="access-choice-grid">{data.departments.filter((item) => item.attivo !== false).map((department) => <label key={department.id}><input type="checkbox" checked={form.reparto_ids.includes(department.id)} onChange={() => setForm((v) => ({ ...v, reparto_ids: v.reparto_ids.includes(department.id) ? v.reparto_ids.filter((id) => id !== department.id) : [...v.reparto_ids, department.id] }))}/>{department.nome}</label>)}</div></fieldset><label>Agente importato da Mexal<select value={form.mexal_agente_id} onChange={(e) => setForm((v) => ({ ...v, mexal_agente_id: e.target.value }))}><option value="">Utente non agente</option>{data.agents.filter((agent) => agent.attivo_mexal !== false && (!agent.workspace_utente_id || agent.workspace_utente_id === selectedId)).map((agent) => <option key={agent.id} value={agent.id}>{agent.codice} · {fullName(agent)}</option>)}</select><small>I dati commerciali restano sincronizzati da Mexal; responsabile e accessi restano nel Workspace.</small></label><label>Agente collegato alla Beauty Consultant<select value={form.beauty_mexal_agente_id} onChange={(e) => setForm((v) => ({ ...v, beauty_mexal_agente_id: e.target.value }))}><option value="">Nessun agente</option>{data.agents.filter((agent) => agent.attivo_mexal !== false).map((agent) => <option key={agent.id} value={agent.id}>{agent.codice} · {fullName(agent)}</option>)}</select></label></div>{!isCreating && <div className="access-linked"><strong>Persone collegate</strong><span>{linkedPeople.length ? linkedPeople.map(fullName).join(", ") : "Nessuna persona collegata direttamente."}</span></div>}</>}
            {tab === "accessi" && <><div className="access-priority"><ShieldCheck size={20}/><div><strong>Le eccezioni personali prevalgono su area, reparto, ruolo, modulo e schermata.</strong><span>L’amministratore mantiene sempre accesso completo.</span></div></div><div className="access-exception-builder"><label>Ambito<select value={exceptionDraft.ambito} onChange={(e) => setExceptionDraft((v) => ({ ...v, ambito: e.target.value, codice: "" }))}><option value="area">Area</option><option value="modulo">Modulo</option><option value="schermata">Schermata</option><option value="permesso">Funzione</option></select></label><label>Elemento<select value={exceptionDraft.codice} onChange={(e) => setExceptionDraft((v) => ({ ...v, codice: e.target.value }))}><option value="">Seleziona...</option>{targetOptions.map(([code,label]) => <option key={code} value={code}>{label}</option>)}</select></label><label>Decisione<select value={exceptionDraft.decisione} onChange={(e) => setExceptionDraft((v) => ({ ...v, decisione: e.target.value }))}><option value="consenti">Consenti</option><option value="nega">Nega</option></select></label><label>Livello<select value={exceptionDraft.livello_accesso} onChange={(e) => setExceptionDraft((v) => ({ ...v, livello_accesso: e.target.value }))}><option value="">Ereditato</option><option value="lettura">Consultazione</option><option value="scrittura">Operatività</option><option value="amministrazione">Gestione</option></select></label><label>Scadenza<input type="date" value={exceptionDraft.valida_fino_a} onChange={(e) => setExceptionDraft((v) => ({ ...v, valida_fino_a: e.target.value }))}/></label><label className="wide">Motivazione<input value={exceptionDraft.motivazione} onChange={(e) => setExceptionDraft((v) => ({ ...v, motivazione: e.target.value }))} placeholder="Perché viene applicata questa eccezione?"/></label><button type="button" onClick={addException}><Plus size={16}/>Aggiungi eccezione</button></div><div className="access-exceptions">{userExceptions.map((item) => <div key={item.id || `${item.ambito}:${item.codice}`}><span className={`access-decision ${item.decisione}`}>{item.decisione === "consenti" ? "Consenti" : "Nega"}</span><span><strong>{item.codice}</strong><small>{item.ambito}{item.livello_accesso ? ` · ${item.livello_accesso}` : ""}{item.motivazione ? ` · ${item.motivazione}` : ""}</small></span><button type="button" onClick={() => setUserExceptions((current) => current.filter((row) => row !== item))}><X size={16}/></button></div>)}{!userExceptions.length && <p>Nessuna eccezione personale: valgono le regole ereditate.</p>}</div></>}
            {tab === "ai" && <><div className="access-priority"><Bot size={20}/><div><strong>Disponibilità AI per utente</strong><span>Il livello operativo è definito esclusivamente dal ruolo. Qui puoi solo ereditare, consentire o bloccare ogni modulo.</span></div></div><div className="access-ai-list">{data.modules.filter((module) => ["attivita","prodotti","documenti","beauty_days","ordini_pr","ordini_ph","ordini_private","progremes"].includes(module.codice)).map((module) => { const current = aiLevels[module.codice] || { consentito: null, riconoscimento_immagini: null }; const accessValue = current.consentito === null || current.consentito === undefined ? "inherit" : current.consentito ? "allow" : "deny"; return <div key={module.codice}><span><strong>{module.nome}</strong><small>{module.area}</small></span><select value={accessValue} onChange={(e) => setAiLevels((v) => ({ ...v, [module.codice]: { ...current, consentito: e.target.value === "inherit" ? null : e.target.value === "allow" } }))}>{AI_ACCESS_OPTIONS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><label className="access-check"><input type="checkbox" checked={current.riconoscimento_immagini === true} onChange={(e) => setAiLevels((v) => ({ ...v, [module.codice]: { ...current, riconoscimento_immagini: e.target.checked } }))}/>Immagini</label></div>; })}</div></>}
          </div>
          <footer className="access-editor-footer"><span>{isCreating ? "Il nuovo account sarà subito disponibile dopo il salvataggio." : "Le modifiche diventano effettive al successivo aggiornamento della sessione utente."}</span><button type="button" className="primary-action" onClick={saveUser} disabled={saving}><Save size={17}/>{saving ? "Salvataggio..." : "Salva configurazione"}</button></footer>
        </article>
      </div>
    </section>
  );
}

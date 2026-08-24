import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Bot, BriefcaseBusiness, Plus, Search, Sparkles, Store } from "lucide-react";
import WorkspaceAccessGuard from "../../components/WorkspaceAccessGuard";
import ModuleContainerLayout from "../../components/ModuleContainerLayout";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import CrmAIBrief from "./CrmAIBrief";
import { crmTypeConfig, formatDate, formatMoney } from "./crmConfig";
import "./crm.css";

function Screen({ moduleCode, screenCode, children }) {
  return <WorkspaceAccessGuard moduleCode={moduleCode} screenCode={screenCode}>{children}</WorkspaceAccessGuard>;
}

function ErrorBox({ error, retry }) {
  return error ? <div className="crm-message error"><span>{error}</span>{retry ? <button type="button" onClick={retry}>Riprova</button> : null}</div> : null;
}

function CrmOverview() {
  const { hasModuleAccess } = useAuth();
  const items = [
    { code: "crm_conto_terzi", name: "Conto Terzi", description: "Aziende, brief prodotto, campionature e opportunità.", to: "/crm/conto-terzi", icon: BriefcaseBusiness },
    { code: "crm_b2b", name: "B2B", description: "Farmacie, distributori e clienti professionali collegati a Mexal.", to: "/crm/b2b", icon: Store },
    { code: "crm_online", name: "Online", description: "Clienti ecommerce, campagne, creator e customer journey.", to: "/crm/online", icon: Sparkles },
    { code: "crm_ai", name: "AI Business Assistant", description: "Trasforma un brief approvato in piano, progetto, fasi e reminder.", to: "/crm/ai", icon: Bot },
  ].filter((item) => hasModuleAccess(item.code));
  return <ModuleContainerLayout icon={BriefcaseBusiness} eyebrow="Workspace" title="CRM Platform AI" description="Relazioni e decisioni commerciali nel perimetro autorizzato del Workspace." items={items} emptyTitle="Nessuna area CRM disponibile" emptyDescription="L’amministratore può assegnare i moduli CRM dal catalogo Workspace." />;
}

function Kpi({ label, value, note }) {
  return <article className="crm-kpi"><span>{label}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}</article>;
}

function CrmDashboard({ type }) {
  const config = crmTypeConfig(type);
  const [data, setData] = useState({ accounts: [], opportunities: [], activities: [], briefs: [], campaigns: [], creators: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("90");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const since = new Date(Date.now() - Number(days) * 86400000).toISOString();
    const queries = [
      supabase.from("crm_accounts").select("id,stato,valore_cliente,creato_il,prossima_attivita_il").eq("tipo", type).gte("creato_il", since),
      supabase.from("crm_opportunities").select("id,valore,stage_id,chiusura_prevista,crm_opportunity_stages(finale,vinta),crm_accounts!inner(tipo)").eq("crm_accounts.tipo", type),
      supabase.from("crm_activities").select("id,stato,data_attivita").eq("crm_tipo", type),
      supabase.from("crm_briefs").select("id,stato").eq("crm_tipo", type),
    ];
    if (type === "online") queries.push(supabase.from("crm_campaigns").select("id,stato,budget,data_fine"), supabase.from("crm_creators").select("id,costi,vendite_attribuite"));
    const results = await Promise.all(queries);
    const failure = results.find((result) => result.error)?.error;
    if (failure) setError(failure.message);
    else setData({ accounts: results[0].data || [], opportunities: results[1].data || [], activities: results[2].data || [], briefs: results[3].data || [], campaigns: results[4]?.data || [], creators: results[5]?.data || [] });
    setLoading(false);
  }, [days, type]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const [now] = useState(() => Date.now());
  const openOpportunities = data.opportunities.filter((item) => !item.crm_opportunity_stages?.finale);
  const pipelineValue = openOpportunities.reduce((sum, item) => sum + Number(item.valore || 0), 0);
  const overdue = data.activities.filter((item) => item.stato !== "completata" && item.data_attivita && new Date(item.data_attivita).getTime() < now).length;
  const activeCampaigns = data.campaigns.filter((item) => item.stato === "attiva").length;
  const navigation = type === "conto_terzi"
    ? [["Clienti", `${config.basePath}/clienti`], ["Pipeline", `${config.basePath}/pipeline`], ["Brief", `${config.basePath}/brief`]]
    : type === "b2b"
      ? [["Clienti", `${config.basePath}/clienti`], ["Pipeline", `${config.basePath}/pipeline`]]
      : [["Clienti", `${config.basePath}/clienti`], ["Campagne", `${config.basePath}/campagne`], ["Creator", `${config.basePath}/creator`], ["Customer Journey", `${config.basePath}/customer-journey`]];
  return <div className="crm-page">
    <div className="crm-toolbar"><div><h2>Dashboard {config.label}</h2><p>I valori riflettono soltanto i record compresi nel tuo ambito dati.</p></div><label>Intervallo<select value={days} onChange={(event) => setDays(event.target.value)}><option value="30">30 giorni</option><option value="90">90 giorni</option><option value="365">12 mesi</option></select></label></div>
    <nav className="crm-quick-nav" aria-label={`Aree CRM ${config.label}`}>{navigation.map(([label, to]) => <Link key={to} to={to}>{label}</Link>)}</nav>
    <ErrorBox error={error} retry={load} />
    {loading ? <div className="crm-loading">Caricamento KPI...</div> : <div className="crm-kpi-grid">
      <Kpi label={type === "online" ? "Clienti ecommerce" : "Clienti attivi"} value={data.accounts.filter((item) => item.stato === "attivo" || item.stato === "cliente_attivo").length} />
      <Kpi label="Nuovi clienti / prospect" value={data.accounts.length} note={`Ultimi ${days} giorni`} />
      <Kpi label="Opportunità aperte" value={openOpportunities.length} />
      <Kpi label="Valore pipeline" value={formatMoney(pipelineValue)} />
      <Kpi label="Brief aperti" value={data.briefs.filter((item) => !["archiviato", "trasformato_in_progetto"].includes(item.stato)).length} />
      <Kpi label="Follow-up scaduti" value={overdue} />
      {type === "online" ? <><Kpi label="Campagne attive" value={activeCampaigns} /><Kpi label="ROAS" value="Dato non disponibile" note="Richiede connettore ADV autorizzato" /><Kpi label="CAC / LTV" value="Dato non disponibile" note="Richiede costi marketing ed ecommerce" /></> : null}
      {type === "b2b" ? <><Kpi label="Fatturato" value="Dato da Mexal" note="Disponibile nelle schede collegate" /><Kpi label="Clienti senza riordino" value="Dato non disponibile" note="Richiede soglia temporale configurata" /></> : null}
    </div>}
  </div>;
}

const EMPTY_ACCOUNT = { nome: "", stato: "prospect", email: "", telefono: "", codice_cliente_mexal: "" };

function AccountsPage({ type }) {
  const config = crmTypeConfig(type);
  const { profile, canUseModule } = useAuth();
  const canWrite = canUseModule(config.moduleCode, "scrittura");
  const [rows, setRows] = useState([]); const [search, setSearch] = useState(""); const [status, setStatus] = useState("");
  const [form, setForm] = useState(EMPTY_ACCOUNT); const [open, setOpen] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async () => {
    let query = supabase.from("crm_accounts").select("id,nome,stato,stato_relazione,valore_cliente,email,telefono,codice_cliente_mexal,ultima_attivita_il,prossima_attivita_il,crm_opportunities(count)").eq("tipo", type).order("aggiornato_il", { ascending: false }).limit(500);
    if (status) query = query.eq("stato", status);
    if (search.trim()) query = query.or(`nome.ilike.%${search.trim()}%,codice_cliente_mexal.ilike.%${search.trim()}%,email.ilike.%${search.trim()}%`);
    const { data, error: loadError } = await query; if (loadError) setError(loadError.message); else { setRows(data || []); setError(""); }
  }, [search, status, type]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer); }, [load]);
  async function save(event) {
    event.preventDefault(); if (!canWrite) return;
    const payload = { ...form, tipo: type, nome: form.nome.trim(), responsabile_id: profile.id, reparto_id: profile.reparto_ids?.[0] || profile.reparto_id || null, creato_da: profile.id, codice_cliente_mexal: form.codice_cliente_mexal.trim() || null };
    const { error: saveError } = await supabase.from("crm_accounts").insert(payload); if (saveError) return setError(saveError.message);
    setForm(EMPTY_ACCOUNT); setOpen(false); await load();
  }
  return <div className="crm-page"><div className="crm-toolbar"><div><h2>Clienti {config.label}</h2><p>Ricerca server-side, stato e collegamenti commerciali.</p></div>{canWrite ? <button className="crm-primary" type="button" onClick={() => setOpen(true)}><Plus size={17} />Nuovo cliente</button> : null}</div>
    <div className="crm-filters"><label><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, email o codice Mexal" /></label><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Tutti gli stati</option><option value="prospect">Prospect</option><option value="attivo">Attivo</option><option value="inattivo">Inattivo</option></select></div>
    <ErrorBox error={error} retry={load} />
    <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Cliente</th><th>Stato</th><th>Valore</th><th>Ultima attività</th><th>Prossima attività</th><th>Opportunità</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><Link to={`${config.basePath}/clienti/${row.id}`}><strong>{row.nome}</strong><small>{row.codice_cliente_mexal || row.email || "Anagrafica Workspace"}</small></Link></td><td><span className="crm-status">{row.stato}</span></td><td>{formatMoney(row.valore_cliente)}</td><td>{formatDate(row.ultima_attivita_il)}</td><td>{formatDate(row.prossima_attivita_il)}</td><td>{row.crm_opportunities?.[0]?.count || 0}</td></tr>)}</tbody></table>{!rows.length ? <div className="crm-empty">Nessun cliente visibile con i filtri correnti.</div> : null}</div>
    {open ? <div className="crm-modal-backdrop"><form className="crm-modal" onSubmit={save}><h3>Nuovo cliente {config.label}</h3><label>Nome<input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label><div className="crm-form-grid"><label>Stato<select value={form.stato} onChange={(e) => setForm({ ...form, stato: e.target.value })}><option value="prospect">Prospect</option><option value="attivo">Attivo</option></select></label><label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>Telefono<input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></label>{type === "b2b" ? <label>Codice cliente Mexal<input value={form.codice_cliente_mexal} onChange={(e) => setForm({ ...form, codice_cliente_mexal: e.target.value })} /></label> : null}</div><div className="crm-modal-actions"><button type="button" onClick={() => setOpen(false)}>Annulla</button><button className="crm-primary">Salva</button></div></form></div> : null}
  </div>;
}

function AccountDetail({ type }) {
  const { id } = useParams(); const config = crmTypeConfig(type); const { profile, canUseModule } = useAuth();
  const canWrite = canUseModule(config.moduleCode, "scrittura");
  const [account, setAccount] = useState(null); const [related, setRelated] = useState({ contacts: [], opportunities: [], activities: [], briefs: [], orders: [], invoices: [] }); const [error, setError] = useState("");
  const [activity, setActivity] = useState({ tipo: "telefonata", titolo: "", data_attivita: "" });
  const load = useCallback(async () => {
    const accountResult = await supabase.from("crm_accounts").select("*").eq("id", id).eq("tipo", type).maybeSingle();
    if (accountResult.error || !accountResult.data) return setError(accountResult.error?.message || "Cliente non trovato o non autorizzato.");
    const current = accountResult.data; setAccount(current);
    const requests = [supabase.from("crm_contacts").select("*").eq("account_id", id), supabase.from("crm_opportunities").select("*,crm_opportunity_stages(nome)").eq("account_id", id), supabase.from("crm_activities").select("*").eq("account_id", id).order("data_attivita", { ascending: false }), supabase.from("crm_briefs").select("id,titolo,stato,aggiornato_il").eq("account_id", id)];
    if (type === "b2b" && current.codice_cliente_mexal) requests.push(supabase.from("ordini_testate").select("id,numero_ordine_visualizzato,data_ordine,stato,totale_documento").eq("codice_cliente", current.codice_cliente_mexal).order("data_ordine", { ascending: false }).limit(50), supabase.from("mexal_fatture_vendita").select("id,numero_documento,data_documento,totale_documento").eq("codice_cliente", current.codice_cliente_mexal).order("data_documento", { ascending: false }).limit(50));
    const results = await Promise.all(requests); setRelated({ contacts: results[0].data || [], opportunities: results[1].data || [], activities: results[2].data || [], briefs: results[3].data || [], orders: results[4]?.data || [], invoices: results[5]?.data || [] });
  }, [id, type]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function addActivity(event) {
    event.preventDefault(); if (!canWrite || !activity.titolo.trim()) return;
    let reminderId = null;
    if (activity.data_attivita) { const reminder = await supabase.from("agenda_reminder").insert({ utente_id: profile.id, titolo: activity.titolo.trim(), descrizione: `CRM ${config.label}: ${account.nome}`, deadline: activity.data_attivita.slice(0, 10), stato: "Aperto" }).select("id").single(); reminderId = reminder.data?.id || null; }
    const { error: insertError } = await supabase.from("crm_activities").insert({ ...activity, crm_tipo: type, account_id: id, responsabile_id: profile.id, reparto_id: account.reparto_id, reminder_id: reminderId, creato_da: profile.id });
    if (insertError) return setError(insertError.message); setActivity({ tipo: "telefonata", titolo: "", data_attivita: "" }); await load();
  }
  if (error) return <ErrorBox error={error} retry={load} />; if (!account) return <div className="crm-loading">Caricamento cliente...</div>;
  return <div className="crm-page"><div className="crm-toolbar"><div><span className="crm-eyebrow">{config.label}</span><h2>{account.nome}</h2><p>{account.codice_cliente_mexal ? `Mexal ${account.codice_cliente_mexal}` : "Anagrafica CRM Workspace"}</p></div><Link className="crm-secondary" to={`${config.basePath}/clienti`}>Torna ai clienti</Link></div>
    <div className="crm-detail-grid"><section className="crm-panel"><h3>Anagrafica</h3><dl><div><dt>Stato</dt><dd>{account.stato}</dd></div><div><dt>Email</dt><dd>{account.email || "—"}</dd></div><div><dt>Telefono</dt><dd>{account.telefono || "—"}</dd></div><div><dt>Valore</dt><dd>{formatMoney(account.valore_cliente)}</dd></div></dl></section><section className="crm-panel"><h3>AI Summary</h3><p>La sintesi AI viene generata soltanto su richiesta dall’AI Business Assistant e nel perimetro autorizzato.</p><Link to="/crm/ai" state={{ accountId: id, crmType: type }}>Apri AI Brief</Link></section></div>
    <div className="crm-tabs"><section className="crm-panel"><h3>Timeline e attività</h3>{canWrite ? <form className="crm-inline-form" onSubmit={addActivity}><select value={activity.tipo} onChange={(e) => setActivity({ ...activity, tipo: e.target.value })}>{["telefonata","email","visita","videocall","presentazione","formazione","campionatura","follow_up"].map((value) => <option key={value}>{value}</option>)}</select><input required placeholder="Titolo attività" value={activity.titolo} onChange={(e) => setActivity({ ...activity, titolo: e.target.value })} /><input type="datetime-local" value={activity.data_attivita} onChange={(e) => setActivity({ ...activity, data_attivita: e.target.value })} /><button className="crm-primary"><Plus size={16} />Aggiungi</button></form> : null}<ul className="crm-timeline">{related.activities.map((item) => <li key={item.id}><strong>{item.titolo}</strong><span>{item.tipo} · {formatDate(item.data_attivita)}</span></li>)}</ul></section>
      <section className="crm-panel"><h3>Opportunità</h3>{related.opportunities.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.titolo}</strong><span>{item.crm_opportunity_stages?.nome || "Senza fase"} · {formatMoney(item.valore)}</span></div>)}</section>
      <section className="crm-panel"><h3>Brief</h3>{related.briefs.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.titolo}</strong><span>{item.stato}</span></div>)}</section>
      {type === "b2b" ? <><section className="crm-panel"><h3>Ordini Mexal</h3>{account.codice_cliente_mexal ? related.orders.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.numero_ordine_visualizzato}</strong><span>{formatDate(item.data_ordine)} · {formatMoney(item.totale_documento)}</span></div>) : <p>Collega il codice cliente Mexal per consultare gli ordini autorizzati.</p>}</section><section className="crm-panel"><h3>Fatture Mexal</h3>{related.invoices.map((item) => <div className="crm-row-card" key={item.id}><strong>{item.numero_documento}</strong><span>{formatDate(item.data_documento)} · {formatMoney(item.totale_documento)}</span></div>)}</section></> : null}
    </div>
  </div>;
}

function Pipeline({ type }) {
  const config = crmTypeConfig(type); const { profile, canUseModule } = useAuth(); const canWrite = canUseModule(config.moduleCode, "scrittura");
  const [stages, setStages] = useState([]); const [items, setItems] = useState([]); const [accounts, setAccounts] = useState([]); const [error, setError] = useState("");
  const [form, setForm] = useState({ titolo: "", account_id: "", valore: "" });
  const load = useCallback(async () => { const [s, o, a] = await Promise.all([supabase.from("crm_opportunity_stages").select("*").eq("crm_tipo", type).eq("attiva", true).order("ordine"), supabase.from("crm_opportunities").select("*,crm_accounts!inner(nome,tipo)").eq("crm_accounts.tipo", type), supabase.from("crm_accounts").select("id,nome").eq("tipo", type).order("nome")]); const failure = s.error || o.error || a.error; if (failure) setError(failure.message); else { setStages(s.data || []); setItems(o.data || []); setAccounts(a.data || []); } }, [type]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function create(event) { event.preventDefault(); const first = stages[0]; if (!first) return; const { error: e } = await supabase.from("crm_opportunities").insert({ ...form, valore: form.valore ? Number(form.valore) : null, stage_id: first.id, responsabile_id: profile.id, reparto_id: profile.reparto_ids?.[0] || null, creato_da: profile.id }); if (e) setError(e.message); else { setForm({ titolo: "", account_id: "", valore: "" }); await load(); } }
  async function move(id, stageId) { if (!canWrite) return; const { error: e } = await supabase.from("crm_opportunities").update({ stage_id: stageId }).eq("id", id); if (e) setError(e.message); else await load(); }
  return <div className="crm-page"><div className="crm-toolbar"><div><h2>Pipeline {config.label}</h2><p>Le fasi sono configurate nel database e non nel componente.</p></div></div><ErrorBox error={error} retry={load} />{canWrite ? <form className="crm-inline-form" onSubmit={create}><input required placeholder="Titolo opportunità" value={form.titolo} onChange={(e) => setForm({ ...form, titolo: e.target.value })} /><select required value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}><option value="">Cliente</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</select><input type="number" min="0" step="0.01" placeholder="Valore" value={form.valore} onChange={(e) => setForm({ ...form, valore: e.target.value })} /><button className="crm-primary"><Plus size={16} />Crea</button></form> : null}<div className="crm-kanban">{stages.map((stage) => <section key={stage.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => void move(e.dataTransfer.getData("text/plain"), stage.id)}><header><strong>{stage.nome}</strong><span>{items.filter((item) => item.stage_id === stage.id).length}</span></header>{items.filter((item) => item.stage_id === stage.id).map((item) => <article draggable={canWrite} onDragStart={(e) => e.dataTransfer.setData("text/plain", item.id)} key={item.id}><strong>{item.titolo}</strong><span>{item.crm_accounts?.nome}</span><small>{formatMoney(item.valore)}</small></article>)}</section>)}</div></div>;
}

function BriefsPage() {
  const { profile, canUseModule } = useAuth(); const canWrite = canUseModule("crm_conto_terzi", "scrittura"); const [rows, setRows] = useState([]); const [accounts, setAccounts] = useState([]); const [form, setForm] = useState({ titolo: "", account_id: "", obiettivo: "", target: "", categoria: "" }); const [error, setError] = useState("");
  const load = useCallback(async () => { const [b, a] = await Promise.all([supabase.from("crm_briefs").select("id,titolo,stato,obiettivo,target,categoria,aggiornato_il,crm_accounts(nome)").eq("crm_tipo", "conto_terzi").order("aggiornato_il", { ascending: false }), supabase.from("crm_accounts").select("id,nome").eq("tipo", "conto_terzi").order("nome")]); if (b.error || a.error) setError((b.error || a.error).message); else { setRows(b.data || []); setAccounts(a.data || []); } }, []); useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function save(e) { e.preventDefault(); const { error: x } = await supabase.from("crm_briefs").insert({ ...form, crm_tipo: "conto_terzi", account_id: form.account_id || null, responsabile_id: profile.id, reparto_id: profile.reparto_ids?.[0] || null, creato_da: profile.id }); if (x) setError(x.message); else { setForm({ titolo: "", account_id: "", obiettivo: "", target: "", categoria: "" }); await load(); } }
  return <div className="crm-page"><div className="crm-toolbar"><div><h2>Brief Cliente</h2><p>Brief collegabili a opportunità, prodotti, documenti e AI Business Assistant.</p></div><Link className="crm-primary" to="/crm/ai"><Bot size={17} />Apri AI Brief</Link></div><ErrorBox error={error} />{canWrite ? <form className="crm-card-form" onSubmit={save}><input required placeholder="Titolo brief" value={form.titolo} onChange={(e) => setForm({ ...form, titolo: e.target.value })} /><select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}><option value="">Cliente opzionale</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</select><input placeholder="Obiettivo" value={form.obiettivo} onChange={(e) => setForm({ ...form, obiettivo: e.target.value })} /><input placeholder="Target" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} /><input placeholder="Categoria" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} /><button className="crm-primary"><Plus size={16} />Salva brief</button></form> : null}<div className="crm-list-grid">{rows.map((row) => <article className="crm-list-card" key={row.id}><span>{row.stato}</span><h3>{row.titolo}</h3><p>{row.crm_accounts?.nome || row.obiettivo || "Brief non ancora associato"}</p><small>{row.target || row.categoria || "Dati da completare"}</small></article>)}</div></div>;
}

function OnlineManager({ entity }) {
  const { profile, canUseModule } = useAuth(); const canWrite = canUseModule("crm_online", "scrittura"); const campaign = entity === "campaigns"; const creator = entity === "creators"; const table = campaign ? "crm_campaigns" : creator ? "crm_creators" : "crm_customer_events";
  const [rows, setRows] = useState([]); const [accounts, setAccounts] = useState([]); const [form, setForm] = useState(campaign ? { nome: "", obiettivo: "", canale: "", budget: "", stato: "bozza" } : creator ? { nome: "", piattaforma: "", profilo: "", nicchia: "", follower: "" } : { account_id: "", fase: "lead", fonte: "", consenso_riferimento: "" }); const [error, setError] = useState("");
  const load = useCallback(async () => { const [r, a] = await Promise.all([supabase.from(table).select(entity === "journey" ? "*,crm_accounts(nome)" : "*").order(entity === "journey" ? "avvenuto_il" : "creato_il", { ascending: false }).limit(500), supabase.from("crm_accounts").select("id,nome").eq("tipo", "online").order("nome")]); if (r.error) setError(r.error.message); else { setRows(r.data || []); setAccounts(a.data || []); } }, [entity, table]); useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function save(e) { e.preventDefault(); const payload = campaign ? { ...form, budget: form.budget ? Number(form.budget) : null, responsabile_id: profile.id, reparto_id: profile.reparto_ids?.[0] || null, creato_da: profile.id } : creator ? { ...form, follower: form.follower ? Number(form.follower) : null, responsabile_id: profile.id, reparto_id: profile.reparto_ids?.[0] || null, creato_da: profile.id } : { ...form, creato_da: profile.id }; const { error: x } = await supabase.from(table).insert(payload); if (x) setError(x.message); else { await load(); } }
  const title = campaign ? "Campaign Manager" : creator ? "Creator Management" : "Customer Journey";
  return <div className="crm-page"><div className="crm-toolbar"><div><h2>{title}</h2><p>{campaign ? "Obiettivi, canali, budget e KPI senza inventare fonti dati." : creator ? "Collaborazioni, contenuti, costi e vendite attribuite." : "Eventi minimali e autorizzati; nessun tracking invasivo."}</p></div></div><ErrorBox error={error} />{canWrite ? <form className="crm-card-form" onSubmit={save}>{campaign ? <><input required placeholder="Nome campagna" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /><input placeholder="Obiettivo" value={form.obiettivo} onChange={(e) => setForm({ ...form, obiettivo: e.target.value })} /><input placeholder="Canale" value={form.canale} onChange={(e) => setForm({ ...form, canale: e.target.value })} /><input type="number" placeholder="Budget" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></> : creator ? <><input required placeholder="Nome creator" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /><input placeholder="Piattaforma" value={form.piattaforma} onChange={(e) => setForm({ ...form, piattaforma: e.target.value })} /><input placeholder="Profilo / canale" value={form.profilo} onChange={(e) => setForm({ ...form, profilo: e.target.value })} /><input type="number" placeholder="Follower" value={form.follower} onChange={(e) => setForm({ ...form, follower: e.target.value })} /></> : <><select required value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}><option value="">Cliente online</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</select><select value={form.fase} onChange={(e) => setForm({ ...form, fase: e.target.value })}>{["lead","visita","interesse","iscrizione","carrello","acquisto","riacquisto","recensione","loyalty"].map((v) => <option key={v}>{v}</option>)}</select><input placeholder="Fonte autorizzata" value={form.fonte} onChange={(e) => setForm({ ...form, fonte: e.target.value })} /><input placeholder="Riferimento consenso" value={form.consenso_riferimento} onChange={(e) => setForm({ ...form, consenso_riferimento: e.target.value })} /></>}<button className="crm-primary"><Plus size={16} />Aggiungi</button></form> : null}<div className="crm-list-grid">{rows.map((row) => <article className="crm-list-card" key={row.id}><span>{row.stato || row.stato_collaborazione || row.fase}</span><h3>{row.nome || row.crm_accounts?.nome || row.fase}</h3><p>{row.obiettivo || row.piattaforma || row.fonte || "Informazioni da completare"}</p><small>{campaign ? formatMoney(row.budget) : creator ? `${row.follower || 0} follower` : formatDate(row.avvenuto_il)}</small></article>)}</div></div>;
}

export default function CrmModule() {
  return <Routes>
    <Route index element={<Screen moduleCode="crm" screenCode="crm.dashboard"><CrmOverview /></Screen>} />
    <Route path="conto-terzi" element={<Screen moduleCode="crm_conto_terzi" screenCode="crm.conto_terzi.dashboard"><CrmDashboard type="conto_terzi" /></Screen>} />
    <Route path="conto-terzi/clienti" element={<Screen moduleCode="crm_conto_terzi" screenCode="crm.conto_terzi.clienti"><AccountsPage type="conto_terzi" /></Screen>} />
    <Route path="conto-terzi/clienti/:id" element={<Screen moduleCode="crm_conto_terzi" screenCode="crm.conto_terzi.cliente"><AccountDetail type="conto_terzi" /></Screen>} />
    <Route path="conto-terzi/pipeline" element={<Screen moduleCode="crm_conto_terzi" screenCode="crm.conto_terzi.pipeline"><Pipeline type="conto_terzi" /></Screen>} />
    <Route path="conto-terzi/brief" element={<Screen moduleCode="crm_conto_terzi" screenCode="crm.conto_terzi.brief"><BriefsPage /></Screen>} />
    <Route path="b2b" element={<Screen moduleCode="crm_b2b" screenCode="crm.b2b.dashboard"><CrmDashboard type="b2b" /></Screen>} />
    <Route path="b2b/clienti" element={<Screen moduleCode="crm_b2b" screenCode="crm.b2b.clienti"><AccountsPage type="b2b" /></Screen>} />
    <Route path="b2b/clienti/:id" element={<Screen moduleCode="crm_b2b" screenCode="crm.b2b.cliente"><AccountDetail type="b2b" /></Screen>} />
    <Route path="b2b/pipeline" element={<Screen moduleCode="crm_b2b" screenCode="crm.b2b.pipeline"><Pipeline type="b2b" /></Screen>} />
    <Route path="online" element={<Screen moduleCode="crm_online" screenCode="crm.online.dashboard"><CrmDashboard type="online" /></Screen>} />
    <Route path="online/clienti" element={<Screen moduleCode="crm_online" screenCode="crm.online.clienti"><AccountsPage type="online" /></Screen>} />
    <Route path="online/clienti/:id" element={<Screen moduleCode="crm_online" screenCode="crm.online.clienti"><AccountDetail type="online" /></Screen>} />
    <Route path="online/campagne" element={<Screen moduleCode="crm_online" screenCode="crm.online.campaigns"><OnlineManager entity="campaigns" /></Screen>} />
    <Route path="online/creator" element={<Screen moduleCode="crm_online" screenCode="crm.online.creators"><OnlineManager entity="creators" /></Screen>} />
    <Route path="online/customer-journey" element={<Screen moduleCode="crm_online" screenCode="crm.online.customer_journey"><OnlineManager entity="journey" /></Screen>} />
    <Route path="ai" element={<Screen moduleCode="crm_ai" screenCode="crm.ai"><CrmAIBrief /></Screen>} />
    <Route path="*" element={<Navigate to="/crm" replace />} />
  </Routes>;
}

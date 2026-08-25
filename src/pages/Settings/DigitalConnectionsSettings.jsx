import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, KeyRound, Play, Plus, RefreshCw, Save, ShieldCheck, Unplug } from "lucide-react";
import { Link } from "react-router-dom";
import { digitalConnectionsService } from "../../modules/integrations/services/digitalConnectionsService";
import "../../modules/crm/crm.css";
import "../../modules/crm/digital.css";
import "../../modules/crm/digital-manager.css";
import "../../modules/crm/workspace-alignment.css";

const emptyForm = (provider = null) => ({
  id: "", providerCode: provider?.providerCode || "", name: provider?.displayName || "",
  authType: provider?.authType || "", syncFrequency: "manual", isDefault: false,
  configuration: Object.fromEntries((provider?.configurationSchema || []).map((field) => [field.name, field.defaultValue ?? ""])),
  secrets: {},
});

function statusLabel(value) {
  return String(value || "non_configurato").replaceAll("_", " ");
}

function Field({ schema, value, onChange }) {
  if (schema.type === "select") return <label>{schema.label}<select required={schema.required} value={value || ""} onChange={(event) => onChange(event.target.value)}>{!schema.required ? <option value="">Non impostato</option> : null}{schema.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{schema.help ? <small>{schema.help}</small> : null}</label>;
  if (schema.type === "multivalue") return <label>{schema.label}<input required={schema.required} value={Array.isArray(value) ? value.join(", ") : value || ""} onChange={(event) => onChange(event.target.value)} placeholder={schema.placeholder || "Valori separati da virgola"} />{schema.help ? <small>{schema.help}</small> : null}</label>;
  return <label>{schema.label}<input type={schema.type === "url" ? "url" : "text"} required={schema.required} value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={schema.placeholder} />{schema.help ? <small>{schema.help}</small> : null}</label>;
}

export default function DigitalConnectionsSettings() {
  const [registry, setRegistry] = useState([]);
  const [connections, setConnections] = useState([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(() => emptyForm());
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState(null);
  const [mapping, setMapping] = useState({ marketplace: "", externalSku: "", asin: "", codiceMexal: "", status: "matched" });

  const provider = useMemo(() => registry.find((item) => item.providerCode === selectedCode) || null, [registry, selectedCode]);
  const current = useMemo(() => connections.find((item) => item.id === selectedId) || null, [connections, selectedId]);

  const load = useCallback(async () => {
    try {
      const result = await digitalConnectionsService.list();
      setRegistry(result.registry || []); setConnections(result.connections || []);
      if (result.registry?.length) setSelectedCode((value) => value || result.registry[0].providerCode);
    } catch (error) { setMessage({ type: "error", text: error.message }); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  function chooseProvider(code) {
    const definition = registry.find((item) => item.providerCode === code);
    setSelectedCode(code); setSelectedId(""); setForm(emptyForm(definition)); setStep(2); setMessage(null);
  }

  function editConnection(connection) {
    setSelectedCode(connection.provider_code); setSelectedId(connection.id);
    setForm({ id: connection.id, providerCode: connection.provider_code, name: connection.nome, authType: connection.auth_type, syncFrequency: connection.sync_frequency, isDefault: connection.is_default, configuration: connection.configurazione || {}, secrets: {} });
    setStep(2); setMessage(null);
  }

  function updateConfiguration(name, value) { setForm((valueNow) => ({ ...valueNow, configuration: { ...valueNow.configuration, [name]: value } })); }
  function updateSecret(name, value) { setForm((valueNow) => ({ ...valueNow, secrets: { ...valueNow.secrets, [name]: value } })); }

  async function run(action, successText) {
    if (!current && !form.id) return;
    const id = current?.id || form.id; setBusy(action); setMessage(null);
    try {
      if (action === "test") await digitalConnectionsService.test(id);
      if (action === "activate") await digitalConnectionsService.activate(id, form.syncFrequency);
      if (action === "sync") await digitalConnectionsService.syncNow(id);
      if (action === "deactivate") await digitalConnectionsService.deactivate(id);
      setMessage({ type: "success", text: successText }); await load();
    } catch (error) { setMessage({ type: "error", text: error.message }); } finally { setBusy(""); }
  }

  async function revokeCredential(name) {
    const id = current?.id || form.id; setBusy(`revoke:${name}`);
    try { await digitalConnectionsService.revokeSecret(id, name); setMessage({ type: "success", text: "Credenziale revocata; la connessione e stata disattivata." }); await load(); }
    catch (error) { setMessage({ type: "error", text: error.message }); } finally { setBusy(""); }
  }

  async function saveProductMapping() {
    const id = current?.id || form.id; setBusy("mapping");
    try { await digitalConnectionsService.saveMapping({ connectionId: id, ...mapping }); setMessage({ type: "success", text: "Mapping prodotto salvato nel catalogo di corrispondenza." }); setMapping({ marketplace: "", externalSku: "", asin: "", codiceMexal: "", status: "matched" }); }
    catch (error) { setMessage({ type: "error", text: error.message }); } finally { setBusy(""); }
  }

  async function save(event) {
    event.preventDefault(); setBusy("save"); setMessage(null);
    try {
      const result = await digitalConnectionsService.save(form);
      setSelectedId(result.connection.id); setForm((value) => ({ ...value, id: result.connection.id, secrets: {} })); setStep(4);
      setMessage({ type: result.missingSecrets?.length ? "warning" : "success", text: result.missingSecrets?.length ? "Configurazione salvata. Completa le credenziali obbligatorie." : "Configurazione e credenziali salvate nel vault server-side. Ora esegui il test." });
      await load();
    } catch (error) { setMessage({ type: "error", text: error.message }); } finally { setBusy(""); }
  }

  return <div className="crm-page crm-settings-page">
    <div className="crm-toolbar"><div><span className="crm-eyebrow">Impostazioni / CRM Online</span><h2>Digital Connection Manager</h2><p>Gestione centralizzata di provider, account, credenziali, test e sincronizzazioni.</p></div><div className="crm-plan-actions"><Link className="secondary-action crm-secondary" to="/settings"><ArrowLeft size={16} />Impostazioni</Link><button className="primary-action crm-primary" type="button" onClick={() => { setSelectedId(""); setSelectedCategory(""); setStep(1); }}><Plus size={16} />Nuova connessione</button></div></div>
    <div className="crm-security-note"><ShieldCheck size={22} /><div><strong>Credenziali protette</strong><p>I valori sono cifrati e gestiti solo dal server. La UI riceve esclusivamente maschere e non puo rivelare token, password o chiavi.</p></div></div>
    {message ? <div className={`crm-message ${message.type}`}>{message.text}</div> : null}
    <section className="panel crm-panel"><div className="crm-panel-heading"><div><h3>Connessioni configurate</h3><p>Ogni provider puo avere piu account; attivazione e sync richiedono un test positivo.</p></div><button className="secondary-action crm-secondary" type="button" onClick={() => void load()}><RefreshCw size={16} />Aggiorna</button></div>
      <div className="crm-connection-grid">{connections.map((connection) => <article key={connection.id}><div><strong>{connection.nome}</strong><span className={`crm-data-status ${connection.ultimo_test_stato === "success" ? "available" : connection.stato === "errore" ? "error" : "pending"}`}>{statusLabel(connection.stato)}</span></div><p>{connection.provider}</p><small>{connection.ultimo_sync_il ? `Ultimo sync ${new Date(connection.ultimo_sync_il).toLocaleString("it-IT")}` : "Mai sincronizzato"} / {connection.sync_frequency}</small><small>Webhook: {connection.webhook_stato || "non configurato"}</small><button className="secondary-action crm-secondary" type="button" onClick={() => editConnection(connection)}>Gestisci</button></article>)}</div>
      {!connections.length ? <div className="crm-empty">Nessuna connessione configurata.</div> : null}
    </section>
    <div className="crm-wizard-steps" aria-label="Passaggi configurazione">{["Provider", "Configurazione", "Credenziali", "Test e attivazione"].map((label, index) => <button type="button" key={label} className={step === index + 1 ? "active" : ""} disabled={index + 1 > step && !form.id} onClick={() => setStep(index + 1)}><span>{index + 1}</span>{label}</button>)}</div>
    {step === 1 ? <section className="panel crm-panel"><h3>Seleziona categoria e provider</h3><div className="crm-provider-categories">{[...new Set(registry.map((item) => item.category))].map((category) => <button type="button" className={selectedCategory === category ? "active" : ""} key={category} onClick={() => setSelectedCategory(category)}>{category}</button>)}</div>{selectedCategory ? <div className="crm-provider-grid">{registry.filter((item) => item.category === selectedCategory).map((item) => <button type="button" key={item.providerCode} onClick={() => chooseProvider(item.providerCode)}><strong>{item.displayName}</strong><span>{item.description}</span><small>{item.category} / {item.authType}</small></button>)}</div> : <div className="crm-empty">Scegli prima Ecommerce, Mailing, Marketplace o Advertising.</div>}</section> : null}
    {provider && step >= 2 ? <form className="panel crm-panel crm-connection-form" onSubmit={save}><div className="crm-panel-heading"><div><h3>{provider.displayName}</h3><p>{provider.description}</p></div><span className="crm-data-status pending">Passaggio {step}/4</span></div>
      {step === 2 ? <div className="crm-form-grid"><label>Nome connessione<input required value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} /></label><label>Autenticazione<select value={form.authType} onChange={(event) => setForm((value) => ({ ...value, authType: event.target.value }))}>{provider.authOptions.map((item) => <option key={item}>{item}</option>)}</select></label>{provider.configurationSchema.map((schema) => <Field key={schema.name} schema={schema} value={form.configuration[schema.name]} onChange={(value) => updateConfiguration(schema.name, value)} />)}<label>Frequenza reale<select value={form.syncFrequency} onChange={(event) => setForm((value) => ({ ...value, syncFrequency: event.target.value }))}><option value="manual">Solo manuale</option><option value="daily">Giornaliera</option></select></label><label className="crm-toggle-field"><input type="checkbox" checked={form.isDefault} onChange={(event) => setForm((value) => ({ ...value, isDefault: event.target.checked }))} /><span><strong>Predefinita per categoria</strong><small>Una sola connessione attiva per categoria.</small></span></label></div> : null}
      {step === 3 ? <div><div className="crm-security-note"><KeyRound size={20} /><div><strong>Sostituzione senza lettura</strong><p>Lascia vuoto per conservare il valore mascherato; un nuovo valore sostituisce quello esistente.</p></div></div><div className="crm-form-grid">{provider.secretSchema.map((schema) => <label key={schema.name}>{schema.label}<input type="password" autoComplete="new-password" value={form.secrets[schema.name] || ""} onChange={(event) => updateSecret(schema.name, event.target.value)} placeholder={current?.secrets?.[schema.name] || (schema.required ? "Obbligatorio" : "Opzionale")} />{current?.secrets?.[schema.name] ? <small>Presente: {current.secrets[schema.name]} <button className="crm-link-button" type="button" onClick={() => void revokeCredential(schema.name)}>Revoca</button></small> : null}</label>)}</div></div> : null}
      {step === 4 ? <div className="crm-activation-stack"><div className="crm-activation-panel"><div><CheckCircle2 size={28} /><h3>Verifica prima di attivare</h3><p>Il test e non distruttivo e legge solo identita/account accessibili.</p></div><div className="crm-plan-actions">{provider.capabilities.includes("oauth2") ? <button className="secondary-action crm-secondary" type="button" disabled={Boolean(busy) || !form.id} onClick={() => void run("oauth", "")}><KeyRound size={16} />Collega OAuth</button> : null}<button className="secondary-action crm-secondary" type="button" disabled={Boolean(busy)} onClick={() => void run("test", "Connessione verificata.")}><Play size={16} />Test</button><button className="primary-action crm-primary" type="button" disabled={Boolean(busy) || current?.ultimo_test_stato !== "success"} onClick={() => void run("activate", "Connessione attivata.")}><CheckCircle2 size={16} />Attiva</button><button className="secondary-action crm-secondary" type="button" disabled={Boolean(busy) || !current?.abilitata} onClick={() => void run("sync", "Sincronizzazione completata.")}><RefreshCw size={16} />Sincronizza ora</button><button className="danger-action crm-danger" type="button" disabled={Boolean(busy) || !current?.abilitata} onClick={() => void run("deactivate", "Connessione disattivata.")}><Unplug size={16} />Disattiva</button></div></div>{provider.capabilities.includes("product_mapping") && form.id ? <section className="crm-mapping-editor"><h3>Mapping prodotto manuale</h3><p>Collega SKU/ASIN esterni al codice canonico Workspace/Mexal.</p><div className="crm-form-grid"><label>Marketplace<input value={mapping.marketplace} onChange={(event) => setMapping((value) => ({ ...value, marketplace: event.target.value }))} /></label><label>SKU esterno<input required value={mapping.externalSku} onChange={(event) => setMapping((value) => ({ ...value, externalSku: event.target.value }))} /></label><label>ASIN<input value={mapping.asin} onChange={(event) => setMapping((value) => ({ ...value, asin: event.target.value }))} /></label><label>Codice Workspace/Mexal<input value={mapping.codiceMexal} onChange={(event) => setMapping((value) => ({ ...value, codiceMexal: event.target.value }))} /></label><label>Stato<select value={mapping.status} onChange={(event) => setMapping((value) => ({ ...value, status: event.target.value }))}><option value="matched">Mappato</option><option value="probable">Dubbio</option><option value="unmatched">Non mappato</option><option value="ignored">Ignorato</option></select></label></div><button className="secondary-action crm-secondary" type="button" disabled={busy === "mapping" || !mapping.externalSku} onClick={() => void saveProductMapping()}><Save size={16} />Salva mapping</button></section> : null}</div> : null}
      {step < 4 ? <div className="crm-plan-actions"><button className="secondary-action crm-secondary" type="button" onClick={() => setStep((value) => Math.max(1, value - 1))}>Indietro</button>{step === 2 ? <button className="primary-action crm-primary" type="button" onClick={() => setStep(3)}>Continua</button> : <button className="primary-action crm-primary" disabled={busy === "save"}><Save size={16} />{busy === "save" ? "Salvataggio..." : "Salva e verifica"}</button>}</div> : null}
    </form> : null}
  </div>;
}

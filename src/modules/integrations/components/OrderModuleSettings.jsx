import { useEffect, useState } from "react";
import { ArrowLeft, Save, ShoppingCart } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import { supabase } from "../../../lib/supabaseClient";
import { customerOrderSeriesOptions } from "../../../components/documentSeriesOptions";
import IntegrationStatusBadge from "./IntegrationStatusBadge";

const defaults = {
  invia_automaticamente_mexal: false,
  serie_documento: "",
  invia_email_agente: false,
  invia_email_cliente: false,
  invia_email_responsabile: false,
  backoffice_1_email: "",
  backoffice_2_email: "",
};

function Toggle({ label, checked, onChange }) {
  return <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span>{label}: <strong>{checked ? "SI" : "NO"}</strong></span>
  </label>;
}

function Panel({ code, title, series }) {
  const [config, setConfig] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("ordini_moduli_configurazione")
        .select("*")
        .eq("modulo_ordini", code)
        .maybeSingle();
      if (!active) return;
      if (error) setMessage(error.message);
      else setConfig({ ...defaults, ...data });
      setLoading(false);
    }
    load();
    return () => { active = false; };
  }, [code]);

  function set(key, value) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setMessage("");
    const { error } = await supabase.from("ordini_moduli_configurazione").upsert({
      ...config,
      modulo_ordini: code,
      aggiornato_il: new Date().toISOString(),
    }, { onConflict: "modulo_ordini" });
    setSaving(false);
    setMessage(error ? error.message : "Configurazione salvata.");
  }

  return <section className="mexal-table-panel">
    <div className="mexal-section-heading">
      <div>
        <h3>{title}</h3>
        <p>Impostazioni indipendenti per questa area ordini.</p>
      </div>
      <IntegrationStatusBadge status="configuration" />
    </div>
    {loading ? <p>Caricamento configurazione...</p> : <>
      <div style={{ display: "grid", gap: 16 }}>
        <Toggle label="Invio automatico a Mexal" checked={config.invia_automaticamente_mexal} onChange={(value) => set("invia_automaticamente_mexal", value)} />
        <label><strong>Serie documenti</strong><select value={config.serie_documento} onChange={(event) => set("serie_documento", event.target.value)} style={{ display: "block", width: "100%", minHeight: 40, marginTop: 6 }}><option value="">Usa la configurazione Mexal predefinita</option>{series.map((item) => <option key={item.source_key} value={item.serie}>{item.sigla_documento || item.tipo_documento} · Serie {item.serie} · {item.descrizione}</option>)}</select></label>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 10 }}><legend><strong>Configurazione email</strong></legend><Toggle label="Email agente" checked={config.invia_email_agente} onChange={(value) => set("invia_email_agente", value)} /><Toggle label="Email cliente" checked={config.invia_email_cliente} onChange={(value) => set("invia_email_cliente", value)} /><Toggle label="Responsabile collegato" checked={config.invia_email_responsabile} onChange={(value) => set("invia_email_responsabile", value)} /></fieldset>
        <label>Backoffice 1<input type="email" value={config.backoffice_1_email || ""} onChange={(event) => set("backoffice_1_email", event.target.value)} style={{ display: "block", width: "100%", minHeight: 40, marginTop: 5 }} /></label>
        <label>Backoffice 2<input type="email" value={config.backoffice_2_email || ""} onChange={(event) => set("backoffice_2_email", event.target.value)} style={{ display: "block", width: "100%", minHeight: 40, marginTop: 5 }} /></label>
      </div>
      <button type="button" className="orders-primary" disabled={saving} onClick={save} style={{ marginTop: 18 }}><Save size={16} /> {saving ? "Salvataggio..." : "Salva configurazione"}</button>
      {message && <p role="status">{message}</p>}
    </>}
  </section>;
}

export default function OrderModuleSettings({ moduleCode = null }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [series, setSeries] = useState([]);
  const [seriesError, setSeriesError] = useState("");

  useEffect(() => {
    supabase.from("ordini_serie_documenti").select("*").eq("attiva", true).order("sigla_documento").order("serie").then(({ data, error }) => {
      if (error) setSeriesError(error.message);
      else setSeries(customerOrderSeriesOptions(data || []));
    });
  }, []);

  const panels = moduleCode ? [[moduleCode, moduleCode === "ph" ? "ORDINI PH" : "ORDINI PROF"]] : [["prof", "ORDINI PROF"], ["ph", "ORDINI PH"]];

  if (!moduleCode) {
    return <div>
      <h2>Moduli Ordini</h2>
      <p>Le impostazioni Mexal ed email sono separate per ciascuna area.</p>
      {seriesError && <p role="alert">{seriesError}</p>}
      <div className="mexal-two-columns">{panels.map(([code, title]) => <Panel key={code} code={code} title={title} series={series} />)}</div>
    </div>;
  }

  const title = moduleCode === "ph" ? "Ordini PH" : "Ordini PROF";
  const subtitle = moduleCode === "ph"
    ? "Configurazione integrazione ordini farmacia."
    : "Configurazione integrazione ordini professionali.";

  return <div className="mexal-page">
    <button type="button" className="integrations-back-button" onClick={() => navigate("/integrations")}><ArrowLeft size={18} /> Centro Integrazioni</button>

    <section className="mexal-hero">
      <div className="mexal-hero-main">
        <div className="mexal-logo"><ShoppingCart size={30} /></div>
        <div>
          <div className="mexal-title-line"><h1>{title}</h1><IntegrationStatusBadge status="configuration" /></div>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="mexal-hero-user"><span>Operatore</span><strong>{`${profile?.nome || ""} ${profile?.cognome || ""}`.trim() || "Utente"}</strong></div>
    </section>

    {seriesError && <div className="mexal-alert alert-error"><span>{seriesError}</span></div>}

    <div className="mexal-two-columns">
      <Panel code={moduleCode} title="Configurazione" series={series} />
    </div>
  </div>;
}

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import { customerOrderSeriesOptions, octOrderSeriesOptions } from "../../../components/documentSeriesOptions";
import {
  ORDER_EMAIL_PLACEHOLDERS,
  ORDER_EMAIL_TEMPLATE_DEFAULTS,
  validateOrderEmailTemplate,
} from "../../../../server/orders/order-email-template.js";
import IntegrationStatusBadge from "./IntegrationStatusBadge";

const defaults = {
  invia_automaticamente_mexal: false,
  serie_documento: "",
  invia_email_agente: false,
  invia_email_cliente: false,
  invia_email_responsabile: false,
  backoffice_1_email: "",
  backoffice_2_email: "",
  ...ORDER_EMAIL_TEMPLATE_DEFAULTS,
};

const templateSections = [
  { key: "cliente", title: "Cliente" },
  { key: "agente", title: "Agente" },
  { key: "backoffice", title: "Backoffice e responsabile" },
];

function validateEmailTemplates(config) {
  for (const { key, title } of templateSections) {
    for (const [kind, maxLength] of [["oggetto", 255], ["corpo", 10000]]) {
      const label = `${kind === "oggetto" ? "Oggetto" : "Corpo"} email ${title}`;
      try {
        validateOrderEmailTemplate(config[`email_${key}_${kind}_template`], {
          label,
          maxLength,
        });
      } catch (error) {
        return error.message;
      }
    }
  }
  return "";
}

function Toggle({ label, checked, onChange }) {
  return <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span>{label}: <strong>{checked ? "SI" : "NO"}</strong></span>
  </label>;
}

function TemplateFields({ section, config, onChange }) {
  const subjectKey = `email_${section.key}_oggetto_template`;
  const bodyKey = `email_${section.key}_corpo_template`;
  return <fieldset style={{ border: "1px solid #dbe3ef", borderRadius: 10, padding: 14, margin: 0, display: "grid", gap: 12 }}>
    <legend><strong>{section.title}</strong></legend>
    <label>
      Oggetto
      <input
        type="text"
        value={config[subjectKey] || ""}
        maxLength={255}
        required
        onChange={(event) => onChange(subjectKey, event.target.value)}
        style={{ display: "block", width: "100%", minHeight: 40, marginTop: 5 }}
      />
    </label>
    <label>
      Corpo
      <textarea
        value={config[bodyKey] || ""}
        maxLength={10000}
        required
        rows={6}
        onChange={(event) => onChange(bodyKey, event.target.value)}
        style={{ display: "block", width: "100%", marginTop: 5, resize: "vertical" }}
      />
    </label>
  </fieldset>;
}

function Panel({ code, title, series }) {
  const isPrivate = code === "private";
  const availableSeries = isPrivate ? octOrderSeriesOptions(series) : series;
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
    setMessage("");
    if (isPrivate && !String(config.serie_documento || "").trim()) {
      setMessage("Seleziona la serie OCT prima di salvare la configurazione OrdiniPrivate.");
      return;
    }
    const validationError = validateEmailTemplates(config);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    setSaving(true);
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
        <p>{isPrivate ? "Creazione e invio di un unico OCT a Mexal, senza documenti OCM, OCX o OCI." : "Impostazioni indipendenti per questa area ordini."}</p>
      </div>
      <IntegrationStatusBadge status="configuration" />
    </div>
    {loading ? <p>Caricamento configurazione...</p> : <>
      <div style={{ display: "grid", gap: 16 }}>
        <Toggle label="Invio automatico a Mexal" checked={config.invia_automaticamente_mexal} onChange={(value) => set("invia_automaticamente_mexal", value)} />
        <label><strong>{isPrivate ? "Serie OCT" : "Serie documenti"}</strong><select value={config.serie_documento} onChange={(event) => set("serie_documento", event.target.value)} style={{ display: "block", width: "100%", minHeight: 40, marginTop: 6 }}><option value="">{isPrivate ? "Seleziona la serie OCT (obbligatoria)" : "Usa la configurazione Mexal predefinita"}</option>{availableSeries.map((item) => <option key={item.source_key} value={item.serie}>{item.sigla_documento || item.tipo_documento} · Serie {item.serie} · {item.descrizione}</option>)}</select></label>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 10 }}><legend><strong>Configurazione email</strong></legend><Toggle label="Email agente" checked={config.invia_email_agente} onChange={(value) => set("invia_email_agente", value)} /><Toggle label="Email cliente" checked={config.invia_email_cliente} onChange={(value) => set("invia_email_cliente", value)} /><Toggle label="Responsabile collegato" checked={config.invia_email_responsabile} onChange={(value) => set("invia_email_responsabile", value)} /></fieldset>
        <label>Backoffice 1<input type="email" value={config.backoffice_1_email || ""} onChange={(event) => set("backoffice_1_email", event.target.value)} style={{ display: "block", width: "100%", minHeight: 40, marginTop: 5 }} /></label>
        <label>Backoffice 2<input type="email" value={config.backoffice_2_email || ""} onChange={(event) => set("backoffice_2_email", event.target.value)} style={{ display: "block", width: "100%", minHeight: 40, marginTop: 5 }} /></label>
        <div>
          <strong>Template email</strong>
          <p style={{ margin: "6px 0 10px" }}>
            Placeholder disponibili: {ORDER_EMAIL_PLACEHOLDERS.map((placeholder) => <code key={placeholder} style={{ marginRight: 8 }}>{placeholder}</code>)}
          </p>
          <p style={{ margin: "-4px 0 10px", color: "var(--text-muted, #64748b)" }}>
            Inserisci <code>{"{commenti}"}</code> nel corpo per riportare i commenti scritti durante la compilazione dell&apos;ordine.
          </p>
          <div style={{ display: "grid", gap: 14 }}>
            {templateSections.map((section) => <TemplateFields key={section.key} section={section} config={config} onChange={set} />)}
          </div>
        </div>
      </div>
      <button type="button" className="orders-primary" disabled={saving} onClick={save} style={{ marginTop: 18 }}><Save size={16} /> {saving ? "Salvataggio..." : "Salva configurazione"}</button>
      {message && <p role="status">{message}</p>}
    </>}
  </section>;
}

export default function OrderModuleSettings({ moduleCode = null }) {
  const [series, setSeries] = useState([]);
  const [seriesError, setSeriesError] = useState("");

  useEffect(() => {
    supabase.from("ordini_serie_documenti").select("*").eq("attiva", true).order("sigla_documento").order("serie").then(({ data, error }) => {
      if (error) setSeriesError(error.message);
      else setSeries(customerOrderSeriesOptions(data || []));
    });
  }, []);

  const titles = { prof: "ORDINI PROF", ph: "ORDINI PH", private: "ORDINI PRIVATE · OCT" };
  const panels = moduleCode ? [[moduleCode, titles[moduleCode] || titles.prof]] : [["prof", titles.prof], ["ph", titles.ph], ["private", titles.private]];

  if (!moduleCode) {
    return <div>
      <h2>Moduli Ordini</h2>
      <p>Le impostazioni Mexal ed email sono separate per ciascuna area.</p>
      {seriesError && <p role="alert">{seriesError}</p>}
      <div className="mexal-two-columns">{panels.map(([code, title]) => <Panel key={code} code={code} title={title} series={series} />)}</div>
    </div>;
  }

  return <div className="mexal-page">
    {seriesError && <div className="mexal-alert alert-error"><span>{seriesError}</span></div>}
    <div className="integration-single-panel">
      <Panel code={moduleCode} title="Configurazione" series={series} />
    </div>
  </div>;
}

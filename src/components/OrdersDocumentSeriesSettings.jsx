import { useEffect, useMemo, useState } from "react";
import { Clipboard, RefreshCw, Save } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { customerOrderSeriesOptions } from "./documentSeriesOptions";

async function accessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data?.session?.access_token;
  if (!token) throw new Error("Sessione scaduta.");
  return token;
}

export default function OrdersDocumentSeriesSettings({ canManage }) {
  const [series, setSeries] = useState([]);
  const [config, setConfig] = useState({ serie_ocm: "", serie_ocx: "" });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [seriesRes, configRes] = await Promise.all([
      supabase.from("ordini_serie_documenti").select("*").eq("attiva", true).order("sigla_documento").order("serie"),
      supabase.from("ordini_configurazione_documenti").select("serie_ocm,serie_ocx").eq("id", 1).maybeSingle(),
    ]);
    if (seriesRes.error) console.error(seriesRes.error);
    if (configRes.error) console.error(configRes.error);
    setSeries(seriesRes.data || []);
    setConfig({ serie_ocm: configRes.data?.serie_ocm || "", serie_ocx: configRes.data?.serie_ocx || "" });
    setLoading(false);
  }

  async function sync() {
    if (!canManage) return;
    setSyncing(true); setMessage("Sincronizzazione serie documenti avviata..."); setMessageType("info");
    try {
      const token = await accessToken();
      const response = await fetch("/api/mexal/sync-document-series", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        setDiagnostics(data.diagnostics || null);
        throw new Error([data.error || `Errore HTTP ${response.status}`, data.details].filter(Boolean).join(" — "));
      }
      setDiagnostics(null);
      setMessage(`Sincronizzazione completata: ${data.received || 0} serie ricevute, ${data.imported || 0} inserite, ${data.updated || 0} aggiornate.`);
      setMessageType("success");
      await load();
    } catch (error) { setMessage(error.message); setMessageType("error"); }
    finally { setSyncing(false); }
  }

  async function save() {
    if (!canManage) return;
    if (!config.serie_ocm || !config.serie_ocx) { setMessageType("error"); return setMessage("Seleziona entrambe le serie."); }
    setSaving(true); setMessage(""); setMessageType("info");
    const { error } = await supabase.from("ordini_configurazione_documenti").upsert({ id: 1, ...config, aggiornato_il: new Date().toISOString() });
    setSaving(false);
    setMessageType(error ? "error" : "success");
    setMessage(error ? error.message : "Configurazione serie salvata.");
  }

  async function openDiagnostics() {
    if (!diagnostics) {
      const { data, error } = await supabase.from("mexal_sync_runs").select("metadata,started_at").eq("sync_type", "document_series").order("started_at", { ascending: false }).limit(1).maybeSingle();
      if (error) { setMessageType("error"); setMessage("Impossibile leggere la diagnostica amministrativa."); return; }
      setDiagnostics(data?.metadata?.diagnostics || null);
    }
    setDiagnosticsOpen(true);
  }
  async function copyDiagnostics() {
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setMessageType("success"); setMessage("Diagnostica copiata come JSON.");
  }
  // OCM and OCX are choices made by the administrator: both use the same compatible OC series.
  const orderSeriesOptions = useMemo(() => customerOrderSeriesOptions(series), [series]);

  if (loading) return <div style={{ padding: 20 }}>Caricamento serie documenti...</div>;

  return (
    <section style={{ marginBottom: 28, padding: 22, border: "1px solid #dbe3ec", borderRadius: 16, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div><h3 style={{ margin: 0 }}>Serie documenti Mexal</h3><p style={{ margin: "6px 0 0", color: "#64748b" }}>Sincronizza le serie reali e scegli quelle usate per OCM e OCX.</p></div>
        <button type="button" onClick={sync} disabled={!canManage || syncing} style={{ display: "inline-flex", gap: 8, alignItems: "center", padding: "10px 14px" }}><RefreshCw size={17} className={syncing ? "spin" : ""} />{syncing ? "Sincronizzazione..." : "Sincronizza da Mexal"}</button><button type="button" onClick={openDiagnostics} disabled={!canManage} style={{ padding: "10px 14px" }}>Apri diagnostica</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr)) auto", gap: 16, marginTop: 20, alignItems: "end" }}>
        <label><strong>Serie OCM</strong><select value={config.serie_ocm} disabled={!canManage} onChange={(e) => setConfig((c) => ({ ...c, serie_ocm: e.target.value }))} style={{ width: "100%", minHeight: 42, marginTop: 8 }}><option value="">Seleziona...</option>{orderSeriesOptions.map((item) => <option key={`ocm-${item.source_key}`} value={item.serie}>{item.sigla_documento || item.tipo_documento} · Serie {item.serie} · {item.descrizione}</option>)}</select></label>
        <label><strong>Serie OCX</strong><select value={config.serie_ocx} disabled={!canManage} onChange={(e) => setConfig((c) => ({ ...c, serie_ocx: e.target.value }))} style={{ width: "100%", minHeight: 42, marginTop: 8 }}><option value="">Seleziona...</option>{orderSeriesOptions.map((item) => <option key={`ocx-${item.source_key}`} value={item.serie}>{item.sigla_documento || item.tipo_documento} · Serie {item.serie} · {item.descrizione}</option>)}</select></label>
        <button type="button" onClick={save} disabled={!canManage || saving} style={{ minHeight: 42, display: "inline-flex", gap: 8, alignItems: "center", padding: "10px 16px" }}><Save size={17} />{saving ? "Salvataggio..." : "Salva serie"}</button>
      </div>
      {message && <div role="status" style={{ marginTop: 14, padding: 12, borderRadius: 10, background: messageType === "error" ? "#fef2f2" : messageType === "success" ? "#f0fdf4" : "#f8fafc", color: messageType === "error" ? "#991b1b" : "#334155" }}>{message}</div>}
      {!orderSeriesOptions.length && <div style={{ marginTop: 14, color: "#b45309" }}>Nessuna serie OCM/OCX disponibile: esegui prima la sincronizzazione.</div>}
      {diagnosticsOpen && <div role="dialog" aria-label="Diagnostica Mexal" style={{ marginTop: 16, padding: 14, border: "1px solid #cbd5e1", borderRadius: 10, background: "#f8fafc" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}><strong>Diagnostica amministrativa Mexal</strong><button type="button" onClick={copyDiagnostics} disabled={!diagnostics} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Clipboard size={15} />Copia JSON</button></div>{diagnostics ? <pre style={{ overflow: "auto", maxHeight: 360, whiteSpace: "pre-wrap" }}>{JSON.stringify(diagnostics, null, 2)}</pre> : <p>Nessuna diagnostica disponibile per l'ultima run.</p>}</div>}
    </section>
  );
}

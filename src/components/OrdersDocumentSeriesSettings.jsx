import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

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
    setSyncing(true); setMessage("");
    try {
      const token = await accessToken();
      const response = await fetch("/api/mexal/sync-document-series", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Errore HTTP ${response.status}`);
      setMessage(`${data.count || 0} serie documenti sincronizzate da Mexal.`);
      await load();
    } catch (error) { setMessage(error.message); }
    finally { setSyncing(false); }
  }

  async function save() {
    if (!canManage) return;
    if (!config.serie_ocm || !config.serie_ocx) return setMessage("Seleziona entrambe le serie.");
    setSaving(true); setMessage("");
    const { error } = await supabase.from("ordini_configurazione_documenti").upsert({ id: 1, ...config, aggiornato_il: new Date().toISOString() });
    setSaving(false);
    setMessage(error ? error.message : "Configurazione serie salvata.");
  }

  const options = useMemo(() => series.filter((item) => ["", "OC", "OX"].includes(String(item.sigla_documento || "").toUpperCase())), [series]);

  if (loading) return <div style={{ padding: 20 }}>Caricamento serie documenti...</div>;

  return (
    <section style={{ marginBottom: 28, padding: 22, border: "1px solid #dbe3ec", borderRadius: 16, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div><h3 style={{ margin: 0 }}>Serie documenti Mexal</h3><p style={{ margin: "6px 0 0", color: "#64748b" }}>Sincronizza le serie reali e scegli quelle usate per OCM e OCX.</p></div>
        <button type="button" onClick={sync} disabled={!canManage || syncing} style={{ display: "inline-flex", gap: 8, alignItems: "center", padding: "10px 14px" }}><RefreshCw size={17} className={syncing ? "spin" : ""} />{syncing ? "Sincronizzazione..." : "Sincronizza da Mexal"}</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr)) auto", gap: 16, marginTop: 20, alignItems: "end" }}>
        <label><strong>Serie OCM</strong><select value={config.serie_ocm} disabled={!canManage} onChange={(e) => setConfig((c) => ({ ...c, serie_ocm: e.target.value }))} style={{ width: "100%", minHeight: 42, marginTop: 8 }}><option value="">Seleziona...</option>{options.map((item) => <option key={`ocm-${item.id}`} value={item.serie}>{item.sigla_documento || "DOC"} · Serie {item.serie} · {item.descrizione}</option>)}</select></label>
        <label><strong>Serie OCX</strong><select value={config.serie_ocx} disabled={!canManage} onChange={(e) => setConfig((c) => ({ ...c, serie_ocx: e.target.value }))} style={{ width: "100%", minHeight: 42, marginTop: 8 }}><option value="">Seleziona...</option>{options.map((item) => <option key={`ocx-${item.id}`} value={item.serie}>{item.sigla_documento || "DOC"} · Serie {item.serie} · {item.descrizione}</option>)}</select></label>
        <button type="button" onClick={save} disabled={!canManage || saving} style={{ minHeight: 42, display: "inline-flex", gap: 8, alignItems: "center", padding: "10px 16px" }}><Save size={17} />{saving ? "Salvataggio..." : "Salva serie"}</button>
      </div>
      {message && <div style={{ marginTop: 14, padding: 12, background: "#f8fafc", borderRadius: 10 }}>{message}</div>}
      {!options.length && <div style={{ marginTop: 14, color: "#b45309" }}>Nessuna serie disponibile: esegui prima la sincronizzazione.</div>}
    </section>
  );
}

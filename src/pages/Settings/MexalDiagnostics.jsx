import { useMemo, useState } from "react";
import { ArrowLeft, Download, Play, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";

async function runDiagnostics(leftReference, rightReference) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) throw new Error("Sessione scaduta. Effettua nuovamente l'accesso.");

  const response = await fetch("/api/mexal/orders/recover-sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action: "order-contract-diagnostics", leftReference, rightReference }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Errore diagnostica (${response.status}).`);
  return payload;
}

function JsonPanel({ title, value }) {
  return (
    <section className="panel" style={{ minWidth: 0 }}>
      <div className="panel-header"><h3>{title}</h3></div>
      <pre style={{ margin: 0, padding: 16, overflow: "auto", maxHeight: 520, fontSize: 12, lineHeight: 1.45, background: "#f7f7f7", borderRadius: 8 }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

export default function MexalDiagnostics() {
  const navigate = useNavigate();
  const { isAdminUser } = useAuth();
  const [leftReference, setLeftReference] = useState("OC+1+16521");
  const [rightReference, setRightReference] = useState("OC+1+16535");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const importantDifferences = useMemo(() => (result?.differences || []).filter((item) =>
    /(stato|sospes|evad|modulo|causale|tipo|tp_|riga|flag|pagamento|trasporto|provvig|scaden)/i.test(item.field)
  ), [result]);

  async function execute() {
    setLoading(true);
    setError("");
    try {
      setResult(await runDiagnostics(leftReference.trim(), rightReference.trim()));
    } catch (diagnosticError) {
      setError(diagnosticError.message || "Diagnostica non riuscita.");
    } finally {
      setLoading(false);
    }
  }

  function downloadJson() {
    if (!result) return;
    const blob = new Blob([`${JSON.stringify(result, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mexal-contract-${leftReference.replaceAll("+", "-")}-${rightReference.replaceAll("+", "-")}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  if (!isAdminUser) return <div className="orders-empty">Diagnostica Mexal riservata agli amministratori.</div>;

  return (
    <div className="settings-page v4-page">
      <div className="page-title-row">
        <div>
          <button className="orders-secondary" type="button" onClick={() => navigate("/settings")} style={{ marginBottom: 12 }}>
            <ArrowLeft size={18} /> Torna alle impostazioni
          </button>
          <h1>Diagnostica contratti Mexal</h1>
          <p>Confronta un OCM manuale evadibile con un OCM generato da Workspace. I risultati sono sanitizzati.</p>
        </div>
      </div>

      <section className="panel settings-panel">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          <label>OCM manuale con stato E<input value={leftReference} onChange={(event) => setLeftReference(event.target.value)} placeholder="OC+1+16521" /></label>
          <label>OCM Workspace con stato S<input value={rightReference} onChange={(event) => setRightReference(event.target.value)} placeholder="OC+1+16535" /></label>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
          <button className="primary-action" type="button" onClick={execute} disabled={loading}>
            {loading ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}
            {loading ? "Analisi in corso..." : "Confronta documenti"}
          </button>
          {result && <button className="orders-secondary" type="button" onClick={downloadJson}><Download size={18} />Scarica JSON</button>}
        </div>
        {error && <div className="orders-alert orders-alert-error" style={{ marginTop: 16 }}>{error}</div>}
      </section>

      {result && <>
        <section className="panel settings-panel">
          <div className="panel-header"><h3>Differenze tecniche principali</h3></div>
          <p>{result.privacy}</p>
          <div className="orders-table-wrap"><table className="orders-table"><thead><tr><th>Campo</th><th>Documento E</th><th>Documento S</th></tr></thead><tbody>
            {(importantDifferences.length ? importantDifferences : result.differences).map((item) => <tr key={item.field}><td>{item.field}</td><td>{String(item.left ?? "—")}</td><td>{String(item.right ?? "—")}</td></tr>)}
          </tbody></table></div>
        </section>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
          <JsonPanel title={`${result.references.left} · Evadibile`} value={result.left} />
          <JsonPanel title={`${result.references.right} · Sospeso`} value={result.right} />
        </div>
        <div style={{ marginTop: 16 }}><JsonPanel title="Contratti help.json" value={result.help} /></div>
      </>}
    </div>
  );
}

import { useMemo, useState } from "react";
import { ArrowLeft, Download, Play, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabaseClient";

async function postDiagnostics(body) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) throw new Error("Sessione scaduta. Effettua nuovamente l'accesso.");
  const response = await fetch("/api/mexal/orders/recover-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Errore diagnostica (${response.status}).`);
  return payload;
}

function JsonPanel({ title, value }) {
  return <section className="panel" style={{ minWidth: 0 }}><div className="panel-header"><h3>{title}</h3></div><pre style={{ margin: 0, padding: 16, overflow: "auto", maxHeight: 520, fontSize: 12, lineHeight: 1.45, background: "#f7f7f7", borderRadius: 8 }}>{JSON.stringify(value, null, 2)}</pre></section>;
}

export default function MexalDiagnostics() {
  const navigate = useNavigate();
  const { isAdminUser } = useAuth();
  const [leftReference, setLeftReference] = useState("OC+1+16521");
  const [rightReference, setRightReference] = useState("OC+1+16535");
  const [clientCode, setClientCode] = useState("501.02677");
  const [agentCode, setAgentCode] = useState("602.00040");
  const [productCode, setProductCode] = useState("IT0039");
  const [destinationYear, setDestinationYear] = useState("2026");
  const [destinationSeries, setDestinationSeries] = useState("1");
  const [destinationNumber, setDestinationNumber] = useState("16541");
  const [destinationClient, setDestinationClient] = useState("501.03320");
  const [result, setResult] = useState(null);
  const [commercialResult, setCommercialResult] = useState(null);
  const [destinationResult, setDestinationResult] = useState(null);
  const [commissionResult, setCommissionResult] = useState(null);
  const [commissionRulesResult, setCommissionRulesResult] = useState(null);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");

  const importantDifferences = useMemo(() => (result?.differences || []).filter((item) => /(stato|sospes|evad|modulo|causale|tipo|tp_|riga|flag|pagamento|trasporto|provvig|scaden)/i.test(item.field)), [result]);

  async function executeOrders() {
    setLoading("orders"); setError("");
    try { setResult(await postDiagnostics({ action: "order-contract-diagnostics", leftReference: leftReference.trim(), rightReference: rightReference.trim() })); }
    catch (diagnosticError) { setError(diagnosticError.message || "Diagnostica non riuscita."); }
    finally { setLoading(""); }
  }

  async function executeCommercial() {
    setLoading("commercial"); setError("");
    try { setCommercialResult(await postDiagnostics({ action: "commercial-contract-diagnostics", clientCode: clientCode.trim(), agentCode: agentCode.trim(), productCode: productCode.trim() })); }
    catch (diagnosticError) { setError(diagnosticError.message || "Diagnostica non riuscita."); }
    finally { setLoading(""); }
  }

  async function executeDestination() {
    setLoading("destination"); setError("");
    try {
      setDestinationResult(await postDiagnostics({
        action: "order-destination-diagnostics",
        year: destinationYear.trim(),
        series: destinationSeries.trim(),
        number: destinationNumber.trim(),
        clientCode: destinationClient.trim(),
      }));
    } catch (diagnosticError) {
      setError(diagnosticError.message || "Lettura ordine Mexal non riuscita.");
    } finally {
      setLoading("");
    }
  }

  async function executeCommission() {
    setLoading("commission"); setError("");
    try {
      setCommissionResult(await postDiagnostics({
        action: "commission-diagnostics", productCode: productCode.trim(), clientCode: clientCode.trim(),
        manualReference: leftReference.trim(), workspaceReference: rightReference.trim(),
      }));
    } catch (diagnosticError) { setError(diagnosticError.message || "Diagnostica provvigioni non riuscita."); }
    finally { setLoading(""); }
  }

  async function executeCommissionRules() {
    setLoading("commission-rules"); setError("");
    try { setCommissionRulesResult(await postDiagnostics({ action: "commission-rules-diagnostics" })); }
    catch (diagnosticError) { setError(diagnosticError.message || "Diagnostica regole provvigionali non riuscita."); }
    finally { setLoading(""); }
  }

  async function downloadFullHelp() {
    setLoading("full-help-download"); setError("");
    try {
      const help = await postDiagnostics({ action: "full-help-download" });
      downloadJson(help, "mexal-help-completo.json");
    } catch (diagnosticError) {
      setError(diagnosticError.message || "Download help Mexal non riuscito.");
    } finally {
      setLoading("");
    }
  }

  function downloadJson(value, name) {
    if (!value) return;
    const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  }

  if (!isAdminUser) return <div className="orders-empty">Diagnostica Mexal riservata agli amministratori.</div>;

  return <div className="settings-page v4-page">
    <div className="page-title-row"><div><button className="orders-secondary" type="button" onClick={() => navigate("/settings")} style={{ marginBottom: 12 }}><ArrowLeft size={18} /> Torna alle impostazioni</button><h1>Diagnostica contratti Mexal</h1><p>Legge ordini reali e individua i campi corretti usati da Mexal.</p></div></div>

    <section className="panel settings-panel">
      <div className="panel-header"><h3>Leggi ordine manuale per la destinazione</h3></div>
      <p>Valori già impostati sull’ordine OCM manuale indicato. Premi il pulsante per leggere direttamente il documento da Mexal.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
        <label>Anno<input value={destinationYear} onChange={(event) => setDestinationYear(event.target.value)} /></label>
        <label>Serie<input value={destinationSeries} onChange={(event) => setDestinationSeries(event.target.value)} /></label>
        <label>Numero<input value={destinationNumber} onChange={(event) => setDestinationNumber(event.target.value)} /></label>
        <label>Cliente Mexal<input value={destinationClient} onChange={(event) => setDestinationClient(event.target.value)} /></label>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <button className="primary-action" type="button" onClick={executeDestination} disabled={loading === "destination"}>{loading === "destination" ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}{loading === "destination" ? "Lettura in corso..." : "Leggi ordine Mexal"}</button>
        {destinationResult && <button className="orders-secondary" type="button" onClick={() => downloadJson(destinationResult, `mexal-ordine-OC-${destinationSeries}-${destinationNumber}.json`)}><Download size={18} />Scarica JSON ordine</button>}
      </div>
    </section>
    {destinationResult && <>
      <section className="panel settings-panel"><div className="panel-header"><h3>Campi destinazione trovati</h3></div><p>{destinationResult.notice}</p><div className="orders-table-wrap"><table className="orders-table"><thead><tr><th>Percorso campo</th><th>Valore</th></tr></thead><tbody>{(destinationResult.destinationFields || []).map((item, index) => <tr key={`${item.path}-${index}`}><td>{item.path}</td><td><pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(item.value)}</pre></td></tr>)}</tbody></table></div></section>
      <JsonPanel title={`Ordine ${destinationResult.reference}`} value={destinationResult.document} />
    </>}

    <section className="panel settings-panel" style={{ marginTop: 16 }}>
      <div className="panel-header"><h3>Trasporto cliente e provvigione agente-prodotto</h3></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <label>Cliente Mexal<input value={clientCode} onChange={(event) => setClientCode(event.target.value)} /></label>
        <label>Agente Mexal<input value={agentCode} onChange={(event) => setAgentCode(event.target.value)} /></label>
        <label>Prodotto Mexal<input value={productCode} onChange={(event) => setProductCode(event.target.value)} /></label>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <button className="primary-action" type="button" onClick={executeCommercial} disabled={loading === "commercial"}>{loading === "commercial" ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}{loading === "commercial" ? "Analisi in corso..." : "Analizza trasporto e provvigioni"}</button>
        {commercialResult && <button className="orders-secondary" type="button" onClick={() => downloadJson(commercialResult, `mexal-commercial-${clientCode}-${agentCode}-${productCode}.json`)}><Download size={18} />Scarica JSON</button>}
      </div>
    </section>
    {commercialResult && <><section className="panel settings-panel"><div className="panel-header"><h3>Endpoint trovati</h3></div><p>{commercialResult.privacy}</p><p>{commercialResult.successful?.length ? commercialResult.successful.join(" · ") : "Nessun endpoint candidato ha risposto correttamente."}</p></section><JsonPanel title="Contratti trasporto e provvigioni" value={commercialResult} /></>}

    <section className="panel settings-panel" style={{ marginTop: 16 }}>
      <div className="panel-header"><h3>Analisi campi provvigionali reali</h3></div>
      <p>Solo lettura: usa un prodotto e un cliente configurati in Mexal, un OCM manuale con provvigioni calcolate e il corrispondente OCM Workspace. Non vengono effettuati POST o modifiche a Mexal.</p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <button className="primary-action" type="button" onClick={executeCommission} disabled={loading === "commission"}>{loading === "commission" ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}{loading === "commission" ? "Analisi in corso..." : "Analizza provvigioni"}</button>
        {commissionResult && <button className="orders-secondary" type="button" onClick={() => downloadJson(commissionResult, `mexal-provvigioni-${productCode}-${clientCode}.json`)}><Download size={18} />Scarica report JSON</button>}
      </div>
    </section>
    <section className="panel settings-panel" style={{ marginTop: 16 }}>
      <div className="panel-header"><h3>Regole provvigionali</h3></div>
      <p>La diagnostica analizza il catalogo Mexal reale e individua eventuali risorse collegate alle regole provvigionali. È solo lettura, non salva dati e non mostra record completi.</p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><button className="primary-action" type="button" onClick={executeCommissionRules} disabled={loading === "commission-rules"}>{loading === "commission-rules" ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}{loading === "commission-rules" ? "Analisi in corso..." : "Analizza catalogo Mexal"}</button><button className="orders-secondary" type="button" onClick={downloadFullHelp} disabled={loading === "full-help-download"}>{loading === "full-help-download" ? <RefreshCw className="spin" size={18} /> : <Download size={18} />}{loading === "full-help-download" ? "Download in corso..." : "Scarica help Mexal completo"}</button>{commissionRulesResult && <button className="orders-secondary" type="button" onClick={() => downloadJson(commissionRulesResult, "mexal-regole-provvigionali-report.json")}><Download size={18} />Scarica report JSON</button>}</div>
      {commissionRulesResult && <><p style={{ marginTop: 16 }}>{commissionRulesResult.reason}</p><h4>Catalogo Mexal</h4><div className="orders-table-wrap"><table className="orders-table"><thead><tr><th>Risorsa</th><th>Endpoint</th><th>Metodo</th><th>Descrizione</th><th>Termini trovati</th><th>Parametri obbligatori</th><th>Affidabilità</th></tr></thead><tbody>{commissionRulesResult.catalog.map((item) => <tr key={`${item.endpoint}-${item.method}`}><td>{item.resource}</td><td>{item.endpoint}</td><td>{item.method}</td><td>{item.description || "—"}</td><td>{item.matched_terms.join(", ")}</td><td>{item.required_parameters.join(", ") || "nessuno"}</td><td>{item.confidence}</td></tr>)}</tbody></table></div><h4 style={{ marginTop: 16 }}>Prove endpoint</h4><div className="orders-table-wrap"><table className="orders-table"><thead><tr><th>Endpoint</th><th>Metodo</th><th>HTTP</th><th>Stato</th><th>Campi trovati</th><th>Motivo mancata interrogazione</th><th>Prossimo passo</th></tr></thead><tbody>{commissionRulesResult.endpointTests.map((item) => <tr key={`${item.endpoint}-${item.method}`}><td>{item.endpoint}</td><td>{item.method}</td><td>{item.http_status ?? "—"}</td><td>{item.status}</td><td>{item.fields_found.join(", ") || "nessuno"}</td><td>{item.skip_reason || "—"}</td><td>{item.next_step}</td></tr>)}</tbody></table></div></>}
    </section>

    {commissionResult && <>
      <section className="panel settings-panel"><div className="panel-header"><h3>Report campi candidati</h3></div><p>{commissionResult.privacy}</p><div className="orders-table-wrap"><table className="orders-table"><thead><tr><th>Origine</th><th>Percorso JSON</th><th>Tipo</th><th>Esempio reale</th><th>Affidabilità</th></tr></thead><tbody>{commissionResult.report.map((item, index) => <tr key={`${item.source}-${item.path}-${index}`}><td>{item.source}</td><td>{item.path || "—"}</td><td>{item.valueType || "—"}</td><td><pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(item.example)}</pre></td><td>{item.reliability}</td></tr>)}</tbody></table></div></section>
      <section className="panel settings-panel"><div className="panel-header"><h3>Endpoint e stato HTTP</h3></div><div className="orders-table-wrap"><table className="orders-table"><thead><tr><th>Interrogazione</th><th>Endpoint</th><th>HTTP</th><th>Esito</th></tr></thead><tbody>{commissionResult.endpoints.map((item) => <tr key={item.endpoint}><td>{item.label}</td><td>{item.endpoint}</td><td>{item.httpStatus ?? "—"}</td><td>{item.error || "verificato"}</td></tr>)}</tbody></table></div></section>
      <JsonPanel title="Analisi OCM manuale: testata, righe, provvigioni, agente e indici" value={commissionResult.manualOrderAnalysis} />
      <JsonPanel title="Confronti strutturati e JSON reale sanitizzato" value={{ comparisons: commissionResult.comparisons, json: commissionResult.json }} />
    </>}

    <section className="panel settings-panel" style={{ marginTop: 16 }}>
      <div className="panel-header"><h3>Confronto documenti ordine</h3></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}><label>OCM manuale<input value={leftReference} onChange={(event) => setLeftReference(event.target.value)} /></label><label>OCM Workspace<input value={rightReference} onChange={(event) => setRightReference(event.target.value)} /></label></div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}><button className="primary-action" type="button" onClick={executeOrders} disabled={loading === "orders"}>{loading === "orders" ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}{loading === "orders" ? "Analisi in corso..." : "Confronta documenti"}</button>{result && <button className="orders-secondary" type="button" onClick={() => downloadJson(result, "mexal-order-contract.json")}><Download size={18} />Scarica JSON</button>}</div>
      {error && <div className="orders-alert orders-alert-error" style={{ marginTop: 16 }}>{error}</div>}
    </section>

    {result && <><section className="panel settings-panel"><div className="panel-header"><h3>Differenze tecniche principali</h3></div><p>{result.privacy}</p><div className="orders-table-wrap"><table className="orders-table"><thead><tr><th>Campo</th><th>Documento E</th><th>Documento S</th></tr></thead><tbody>{(importantDifferences.length ? importantDifferences : result.differences).map((item) => <tr key={item.field}><td>{item.field}</td><td>{String(item.left ?? "—")}</td><td>{String(item.right ?? "—")}</td></tr>)}</tbody></table></div></section><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}><JsonPanel title={`${result.references.left} · Evadibile`} value={result.left} /><JsonPanel title={`${result.references.right} · Sospeso`} value={result.right} /></div></>}
  </div>;
}

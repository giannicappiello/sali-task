import { useCallback, useEffect, useState } from "react";
import InfoTooltip from "../../../components/InfoTooltip";
import { Link } from "react-router-dom";
import { RefreshCw, Settings, ShieldCheck } from "lucide-react";
import { digitalConnectionsService } from "../services/digitalConnectionsService";
import "../../crm/crm.css";
import "../../crm/digital.css";
import "../../crm/digital-manager.css";
import "../../crm/workspace-alignment.css";

function Status({ value }) {
  const className = value === "connesso" || value === "completed" ? "available" : value === "errore" || value === "failed" ? "error" : "pending";
  return <span className={`crm-data-status ${className}`}>{String(value || "non configurato").replaceAll("_", " ")}</span>;
}

export default function DigitalIntegrationStatus() {
  const [data, setData] = useState({ connections: [], runs: [], audit: [], mappings: [], diagnostics: {} });
  const [error, setError] = useState("");
  const [tab, setTab] = useState("runs");

  const load = useCallback(async () => {
    try { setData(await digitalConnectionsService.operational()); setError(""); }
    catch (loadError) { setError(loadError.message); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const { connections, runs, audit, mappings, diagnostics } = data;

  return <div className="crm-page">
    <div className="crm-toolbar"><div><span className="crm-eyebrow">Centro Integrazioni</span><h2>Digital Commerce</h2><p>Vista operativa in sola lettura: stato, scheduler, run, diagnostica e mapping.</p></div><div className="crm-plan-actions"><button className="secondary-action crm-secondary" type="button" onClick={() => void load()}><RefreshCw size={16} />Aggiorna</button><Link className="primary-action crm-primary" to="/settings/crm-digital"><Settings size={16} />Configura</Link></div></div>
    {error ? <div className="crm-message error">{error}</div> : null}
    <div className="crm-kpi-grid"><article className="crm-kpi"><span>Connessioni<InfoTooltip label="Connessioni" text="Numero totale di account di integrazione configurati." /></span><strong>{diagnostics.connectionCount || 0}</strong><small>Account configurati</small></article><article className="crm-kpi"><span>Attive<InfoTooltip label="Attive" text="Connessioni abilitate che hanno superato il test di collegamento." /></span><strong>{diagnostics.activeCount || 0}</strong><small>Test superato e attivate</small></article><article className="crm-kpi"><span>Errori<InfoTooltip label="Errori" text="Connessioni il cui ultimo controllo o sincronizzazione ha restituito un errore." /></span><strong>{diagnostics.failedCount || 0}</strong><small>Richiedono intervento Admin</small></article><article className="crm-kpi"><span>Scheduler<InfoTooltip label="Scheduler" text="Frequenza configurata per il dispatcher server-side delle integrazioni." /></span><strong>{diagnostics.scheduler || "daily"}</strong><small>Dispatcher server-side reale</small></article></div>
    <div className="crm-connection-grid">{connections.map((row) => <article key={row.id}><div><strong>{row.nome}</strong><Status value={row.stato} /></div><p>{row.provider}</p><small>{row.ultimo_sync_il ? `Ultimo sync ${new Date(row.ultimo_sync_il).toLocaleString("it-IT")}` : "Mai sincronizzato"}{row.prossima_run_il ? ` / prossima ${new Date(row.prossima_run_il).toLocaleString("it-IT")}` : ""}</small>{row.ultimo_errore ? <em>{row.ultimo_errore}</em> : null}</article>)}</div>
    {!connections.length ? <div className="crm-empty">Nessuna connessione Digital disponibile.</div> : null}
    <nav className="crm-record-tabs" aria-label="Dettagli operativi"><button className={tab === "runs" ? "active" : ""} type="button" onClick={() => setTab("runs")}>Sincronizzazioni</button><button className={tab === "audit" ? "active" : ""} type="button" onClick={() => setTab("audit")}>Audit</button><button className={tab === "mappings" ? "active" : ""} type="button" onClick={() => setTab("mappings")}>Mapping prodotti</button></nav>
    {tab === "runs" ? <section className="panel crm-panel"><h3>Storico sincronizzazioni</h3><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Data</th><th>Connessione</th><th>Tipo</th><th>Stato</th><th>Letti</th><th>Inseriti</th><th>Aggiornati</th><th>Ignorati</th><th>Errori</th><th>Durata</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td>{new Date(run.created_at).toLocaleString("it-IT")}</td><td>{connections.find((item) => item.id === run.connection_id)?.nome || "-"}</td><td>{run.sync_type}</td><td><Status value={run.status} /></td><td>{run.records_read}</td><td>{run.records_inserted}</td><td>{run.records_updated}</td><td>{run.details?.ignored ?? "-"}</td><td>{run.records_failed}{run.error_message ? ` / ${run.error_message}` : ""}</td><td>{run.duration_ms == null ? "-" : `${run.duration_ms} ms`}</td></tr>)}</tbody></table>{!runs.length ? <div className="crm-empty">Nessuna run disponibile.</div> : null}</div></section> : null}
    {tab === "audit" ? <section className="panel crm-panel"><div className="crm-security-note"><ShieldCheck size={20} /><div><strong>Audit senza segreti</strong><p>Operazioni e risultati sono registrati senza credenziali, header o payload sensibili.</p></div></div><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Data</th><th>Provider</th><th>Operazione</th><th>Esito</th></tr></thead><tbody>{audit.map((row) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString("it-IT")}</td><td>{row.provider_code || "-"}</td><td>{row.operation}</td><td><Status value={row.outcome === "success" ? "completed" : "failed"} /></td></tr>)}</tbody></table>{!audit.length ? <div className="crm-empty">Nessuna operazione registrata.</div> : null}</div></section> : null}
    {tab === "mappings" ? <section className="panel crm-panel"><h3>Mapping prodotti</h3><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Connessione</th><th>Marketplace</th><th>SKU esterno</th><th>ASIN</th><th>Codice Mexal</th><th>Stato</th></tr></thead><tbody>{mappings.map((row) => <tr key={row.id}><td>{connections.find((item) => item.id === row.connection_id)?.nome || "-"}</td><td>{row.marketplace || "-"}</td><td>{row.external_sku}</td><td>{row.asin || "-"}</td><td>{row.codice_mexal || "-"}</td><td><Status value={row.status} /></td></tr>)}</tbody></table>{!mappings.length ? <div className="crm-empty">Nessun mapping disponibile. Il catalogo prodotti Workspace resta la fonte unica.</div> : null}</div></section> : null}
  </div>;
}

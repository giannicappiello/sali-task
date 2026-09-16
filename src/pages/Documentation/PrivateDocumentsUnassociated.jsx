import { useCallback, useEffect, useState } from "react";
import { FileLock2, RefreshCw, Search } from "lucide-react";
import "./PrivateDocumentsUnassociated.css";

export default function PrivateDocumentsUnassociated({ request, refreshKey }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const load = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      const data = await request("unassociated", { method: "GET", signal });
      if (!signal?.aborted) setResult(data);
    } catch (cause) {
      if (!signal?.aborted) setError(cause.message.includes("404")
        ? "Il servizio documentale ProgreMES deve essere aggiornato per usare questa sezione."
        : cause.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    const controller = new AbortController();
    const pending = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(pending); controller.abort(); };
  }, [load, refreshKey]);

  const term = query.trim().toLocaleLowerCase("it");
  const documents = (result?.unassociated || []).filter((item) =>
    `${item.name} ${item.relativePath} ${item.reason}`.toLocaleLowerCase("it").includes(term));

  return <section className="private-unassociated" aria-label="Documenti non associati">
    <header>
      <div><h2>Documenti non associati</h2><p>File sul NAS senza collegamento ad alcun articolo Workspace.</p></div>
      <button type="button" disabled={loading} onClick={() => void load()}><RefreshCw size={17}/>{loading ? "Verifica in corso…" : "Aggiorna elenco"}</button>
    </header>
    <p className="private-unassociated-help">L’associazione automatica viene eseguita dal servizio Workspace e con il pulsante Sincronizza documenti; controlla le cartelle in produzione / Documentazione Mp. Per i file fuori da questo percorso, compresa COA PROGRE, resta disponibile l’associazione manuale dalla scheda articolo.</p>
    <label className="private-unassociated-search"><Search size={18}/><input aria-label="Cerca documenti non associati" placeholder="Cerca per nome, cartella o motivo…" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
    {error && <p role="alert" className="private-documents-error">{error}</p>}
    {result && <p className="private-unassociated-status" role="status">Ultima verifica: {result.scannedAt ? new Date(result.scannedAt).toLocaleString("it-IT") : "non ancora eseguita"} · {result.unassociated.length} non associati{result.associated > 0 ? ` · ${result.associated} nuovi collegamenti creati` : ""}{loading || error ? " · Elenco precedente" : ""}</p>}
    {result?.warnings?.length > 0 && <div className="private-unassociated-warning" role="status"><strong>Verifica parziale</strong><ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
    <div className="private-unassociated-list" aria-busy={loading}>
      {documents.map((item) => <article key={item.relativePath}><FileLock2 size={22}/><div><h3>{item.name}</h3><p className="private-unassociated-path">{item.relativePath}</p><p className="private-unassociated-reason">{item.reason}</p></div><small>{(item.sizeBytes / 1048576).toLocaleString("it-IT", { maximumFractionDigits: 2 })} MB</small></article>)}
      {!loading && !error && result && !documents.length && <p className="private-panel-empty">{term ? "Nessun documento corrisponde alla ricerca." : result.warnings?.length ? "Nessun documento non associato nelle cartelle leggibili." : "Nessun documento non associato."}</p>}
    </div>
  </section>;
}

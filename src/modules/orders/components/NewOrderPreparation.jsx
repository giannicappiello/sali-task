import { useState } from "react";
import { runMexalEventAutomation } from "../services/mexalEventAutomation";

export default function NewOrderPreparation({ isAdmin, onOpen }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  async function prepare() {
    setOpen(true); setRunning(true); setResult(null);
    try { setResult(await runMexalEventAutomation("before_new_order")); }
    catch (error) { setResult({ interrupted: true, results: [{ syncType: "preparazione", success: false, error: error.message }] }); }
    finally { setRunning(false); }
  }
  const failures = (result?.results || []).filter((item) => item.success === false);
  const canContinue = isAdmin || failures.some((item) => item.allow_continue_on_error) || !result?.interrupted;
  function continueAnyway() { setOpen(false); onOpen(); }

  return <>
    <button className="orders-primary" type="button" onClick={prepare} disabled={running}>{running ? "Preparazione Mexal…" : "Nuovo ordine"}</button>
    {open && <div className="orders-preparation-backdrop" role="dialog" aria-modal="true" aria-label="Preparazione nuovo ordine">
      <div className="orders-preparation-modal"><h2>Preparazione nuovo ordine</h2>
        <p>Le automazioni configurate vengono eseguite prima di aprire il modulo.</p>
        <ul>{running && <li><strong>In corso</strong> Preparazione automazioni…</li>}{(result?.results || []).map((item) => <li key={item.id || item.syncType}><strong>{item.skipped ? "Saltata" : item.success ? "Completata" : "Fallita"}</strong> — {item.syncType}{item.error ? `: ${item.error}` : ""}{item.syncType === "stocks" && !item.success ? " Le giacenze potrebbero non essere aggiornate." : ""}</li>)}</ul>
        {!running && result && <div className="orders-preparation-actions">{result.interrupted ? <><button type="button" className="orders-primary" onClick={prepare}>Riprova</button><button type="button" onClick={() => setOpen(false)}>Annulla</button>{canContinue && <button type="button" onClick={continueAnyway}>Continua comunque</button>}</> : <button type="button" className="orders-primary" onClick={continueAnyway}>Apri nuovo ordine</button>}</div>}
      </div></div>}
  </>;
}

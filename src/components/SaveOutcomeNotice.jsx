import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { subscribeSaveOutcomes } from "../save-outcomes.js";
import "./SaveOutcomeNotice.css";

export default function SaveOutcomeNotice() {
  const [outcome, setOutcome] = useState(null);
  useEffect(() => {
    const unsubscribe = subscribeSaveOutcomes(setOutcome);
    const invalid = event => {
      if (!event.target.form || ![...event.target.form.querySelectorAll("button")].some(button => /salva/i.test(button.textContent))) return;
      setOutcome({type:"error",message:"Salvataggio fallito per: " + event.target.validationMessage});
    };
    document.addEventListener("invalid", invalid, true);
    return () => { unsubscribe(); document.removeEventListener("invalid", invalid, true); };
  }, []);
  if (!outcome) return null;
  return createPortal(<div className={"save-outcome-notice " + outcome.type} role={outcome.type === "error" ? "alert" : "status"} aria-live={outcome.type === "error" ? "assertive" : "polite"}>
    <span>{outcome.message}</span><button type="button" aria-label="Chiudi esito salvataggio" onClick={() => setOutcome(null)}>×</button>
  </div>, document.body);
}

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Info, X } from "lucide-react";
import "./BrandedDialogProvider.css";

export default function BrandedDialogProvider() {
  const [dialog, setDialog] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const resolver = useRef(null);
  const datePicker = useRef(null);

  useEffect(() => {
    const originalAlert = window.alert;
    const open = (type, message, options = {}) => new Promise((resolve) => {
      resolver.current = resolve;
      setInputValue(options.defaultValue || "");
      setDialog({ type, message: String(message ?? ""), ...options });
    });
    window.workspaceAlert = (message, options) => open("alert", message, options);
    window.workspaceConfirm = (message, options) => open("confirm", message, options);
    window.workspacePrompt = (message, defaultValue = "", options = {}) => open("prompt", message, { ...options, defaultValue });
    window.alert = (message) => { void open("alert", message); };
    return () => {
      window.alert = originalAlert;
      delete window.workspaceAlert;
      delete window.workspaceConfirm;
      delete window.workspacePrompt;
    };
  }, []);

  function close(value) {
    const resolve = resolver.current;
    resolver.current = null;
    setDialog(null);
    resolve?.(value);
  }

  useEffect(() => {
    if (!dialog) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(dialog.type === "confirm" ? false : null); }
      if (event.key === "Enter" && !(event.shiftKey || event.ctrlKey || event.altKey)) {
        event.preventDefault(); event.stopPropagation();
        close(dialog.type === "prompt" ? inputValue : true);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [dialog, inputValue]);

  if (!dialog) return null;
  const destructive = dialog.variant === "danger" || /elimin|disattiv|arrest|annull/i.test(dialog.message);
  const Icon = destructive ? AlertTriangle : dialog.type === "alert" ? Info : CheckCircle2;
  const cancelValue = dialog.type === "confirm" ? false : null;
  const isItalianDate = dialog.inputType === "italian-date";
  return <div className="brand-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(cancelValue); }}>
    <section className="brand-dialog" role="dialog" aria-modal="true" aria-labelledby="brand-dialog-title">
      <button className="brand-dialog-close" type="button" onClick={() => close(cancelValue)} aria-label="Chiudi"><X size={20} /></button>
      <div className="brand-dialog-brand"><img src="/pwa-192x192.png" alt="" /><span>PROGRE WORKSPACE</span></div>
      <div className={`brand-dialog-icon ${destructive ? "danger" : ""}`}><Icon size={26} /></div>
      <h2 id="brand-dialog-title">{dialog.title || (destructive ? "Conferma operazione" : dialog.type === "prompt" ? "Inserisci i dati" : dialog.type === "confirm" ? "Conferma" : "Messaggio")}</h2>
      <p>{dialog.message}</p>
      {dialog.type === "prompt" && (isItalianDate ? (
        <div className="brand-dialog-date-field">
          <input
            autoFocus
            type="text"
            inputMode="numeric"
            placeholder="gg/mm/aaaa oppure gg/mm/aa"
            aria-label="Data della prossima visita"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
          />
          <input
            ref={datePicker}
            className="brand-dialog-native-date"
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const [year, month, day] = event.target.value.split("-");
              if (year && month && day) setInputValue(`${day}/${month}/${year}`);
            }}
          />
          <button
            type="button"
            className="brand-dialog-calendar"
            onClick={() => datePicker.current?.showPicker?.()}
          >
            <CalendarDays size={18} /> Calendario
          </button>
        </div>
      ) : <input autoFocus type={dialog.inputType || (/password/i.test(dialog.message) ? "password" : "text")} min={dialog.min} step={dialog.step} inputMode={dialog.inputMode} value={inputValue} onChange={(event) => setInputValue(event.target.value)} />)}
      <div className="brand-dialog-actions">
        {dialog.type !== "alert" && <button type="button" className="brand-dialog-secondary" onClick={() => close(cancelValue)}>Annulla</button>}
        <button autoFocus={dialog.type !== "prompt"} type="button" className={destructive ? "brand-dialog-danger" : "brand-dialog-primary"} onClick={() => close(dialog.type === "prompt" ? inputValue : true)}>{dialog.confirmLabel || (dialog.type === "alert" ? "OK" : "Conferma")}</button>
      </div>
    </section>
  </div>;
}

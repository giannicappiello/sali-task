import { useEffect, useRef, useState } from "react";
import { createPortal } from 'react-dom';
import { AlertTriangle, CalendarDays, CheckCircle2, Info, X } from "lucide-react";
import "./BrandedDialogProvider.css";

function visibleViewport() {
  const viewport = window.visualViewport;
  return { top: viewport?.offsetTop || 0, left: viewport?.offsetLeft || 0,
    width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight };
}

export default function BrandedDialogProvider() {
  const [dialog, setDialog] = useState(null);
  const [dialogViewport, setDialogViewport] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const resolver = useRef(null);
  const datePicker = useRef(null);

  useEffect(() => {
    const originalAlert = window.alert;
    const open = (type, message, options = {}) => new Promise((resolve) => {
      resolver.current = resolve;
      setInputValue(options.defaultValue || "");
      setDialogViewport(options.viewportCentered ? visibleViewport() : null);
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

  useEffect(() => {
    if (!dialog?.viewportCentered) return undefined;
    const update = () => setDialogViewport(visibleViewport());
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [dialog?.viewportCentered]);

  if (!dialog) return null;
  const destructive = dialog.variant === "danger" || /elimin|disattiv|arrest|annull/i.test(dialog.message);
  const Icon = destructive ? AlertTriangle : dialog.type === "alert" ? Info : CheckCircle2;
  const cancelValue = dialog.type === "confirm" ? false : null;
  const isItalianDate = dialog.inputType === "italian-date";
  // A confirmation opened from a native modal must stay inside its top layer.
  const portalTarget = document.querySelector('dialog[data-workspace-assistant][open]') || [...document.querySelectorAll('dialog[open]')].at(-1) || document.body;
  return createPortal(<div className={'brand-dialog-backdrop' + (dialog.viewportCentered ? ' viewport-centered' : '')}
    style={dialog.viewportCentered && dialogViewport ? { inset: 'auto', top: dialogViewport.top, left: dialogViewport.left, width: dialogViewport.width, height: dialogViewport.height } : undefined} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(cancelValue); }}>
    <section className="brand-dialog" role={dialog.type === 'alert' && destructive ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="brand-dialog-title">
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
  </div>, portalTarget);
}

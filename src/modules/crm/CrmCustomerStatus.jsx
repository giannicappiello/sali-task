import { useState } from "react";
import { Power, PowerOff } from "lucide-react";
import { CRM_CUSTOMER_STATUS_OPTIONS } from "./crmCustomerStatusModel";

export function CrmCustomerStatusFilter({ value, onChange, id = "crm-customer-status" }) {
  return (
    <label className="crm-status-filter" htmlFor={id}>
      Stato cliente
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {CRM_CUSTOMER_STATUS_OPTIONS.map(([status, label]) => <option key={status} value={status}>{label}</option>)}
      </select>
    </label>
  );
}
export function CrmCustomerStatusBadge({ active }) {
  return <span className={`status-badge ${active ? "success" : "neutral"}`}>{active ? "Attivo" : "Non attivo"}</span>;
}

export function CrmCustomerStatusDialog({ customer, busy, onClose, onConfirm }) {
  if (!customer) return null;
  return <CrmCustomerStatusDialogForm key={customer.entityKey || customer.codice_cliente} customer={customer} busy={busy} onClose={onClose} onConfirm={onConfirm} />;
}

function CrmCustomerStatusDialogForm({ customer, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const nextActive = !customer.crm_active;
  const action = nextActive ? "Riattiva" : "Disattiva";
  return (
    <div className="crm-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="crm-modal crm-status-modal" role="dialog" aria-modal="true" aria-labelledby="crm-status-dialog-title" onSubmit={(event) => { event.preventDefault(); onConfirm({ active: nextActive, reason }); }}>
        <div>
          <span className="crm-eyebrow">Stato operativo CRM</span>
          <h3 id="crm-status-dialog-title">{action} {customer.nome}</h3>
          <p>{nextActive
            ? "Il cliente tornerà nelle viste operative Attivi. Tutto lo storico resta invariato."
            : "Il cliente resterà nell’anagrafica con ordini, fatture, opportunità, attività e documenti. Non verrà eliminato nulla."}</p>
        </div>
        <label>Motivazione opzionale<textarea rows="3" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="crm-modal-actions">
          <button type="button" className="secondary-action crm-secondary" onClick={onClose}>Annulla</button>
          <button type="submit" className={nextActive ? "primary-action crm-primary" : "danger-action crm-danger"} disabled={busy}>
            {nextActive ? <Power size={17} /> : <PowerOff size={17} />}{busy ? "Aggiornamento…" : `${action} cliente`}
          </button>
        </div>
      </form>
    </div>
  );
}

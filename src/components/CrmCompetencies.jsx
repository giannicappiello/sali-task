import { CRM_COMPETENCIES } from '../lib/crmCompetencies';

export function CrmCompetencyBadges({ value = [] }) {
  return <div className="project-crm-badges">{CRM_COMPETENCIES.filter((item) => value.includes(item.value)).map((item) => <span key={item.value}>{item.label}</span>)}{!value.length && <small>Nessuna competenza CRM</small>}</div>;
}

export default function CrmCompetencies({ value = [], onChange, disabled = false }) {
  return <fieldset className="project-crm-field" disabled={disabled}><legend>Competenze CRM</legend><p>Seleziona una o più sezioni CRM. I reparti e le assegnazioni esistenti restano validi.</p><div>{CRM_COMPETENCIES.map((item) => <label key={item.value}><input type="checkbox" checked={value.includes(item.value)} onChange={() => onChange(value.includes(item.value) ? value.filter((entry) => entry !== item.value) : [...value, item.value])} />{item.label}</label>)}</div></fieldset>;
}

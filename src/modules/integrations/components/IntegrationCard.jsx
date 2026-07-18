import { ArrowRight } from "lucide-react";
import IntegrationStatusBadge from "./IntegrationStatusBadge";

export default function IntegrationCard({
  icon: Icon,
  title,
  description,
  status,
  meta,
  onOpen,
  disabled = false,
}) {
  return (
    <article className={`integration-card ${disabled ? "is-disabled" : ""}`}>
      <div className="integration-card-header">
        <div className="integration-card-icon"><Icon size={24} /></div>
        <IntegrationStatusBadge status={status} />
      </div>
      <div className="integration-card-content">
        <h3>{title}</h3>
        <p>{description}</p>
        {meta && <small>{meta}</small>}
      </div>
      <button type="button" onClick={onOpen} disabled={disabled}>
        {disabled ? "Prossimamente" : "Apri integrazione"}
        {!disabled && <ArrowRight size={17} />}
      </button>
    </article>
  );
}

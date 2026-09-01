import { Info } from "lucide-react";

export default function InfoTooltip({ label, text }) {
  const accessibleLabel = `${label || "Informazione"}: ${text}`;

  return (
    <span
      className="info-tooltip"
      role="img"
      tabIndex={0}
      aria-label={accessibleLabel}
      data-tooltip={text}
      title={text}
    >
      <Info size={14} aria-hidden="true" />
    </span>
  );
}

import { ArrowLeft, LayoutGrid } from "lucide-react";

export default function WorkspacePageHeader({
  icon = <LayoutGrid size={29} />,
  backLabel = "",
  onBack,
  eyebrow = "SCHERMATA WORKSPACE",
  title,
  description,
  className = "",
}) {
  const canGoBack = Boolean(backLabel && onBack);

  return (
    <header className={`workspace-page-header ${canGoBack ? "has-back" : ""} ${className}`.trim()}>
      <div className="workspace-page-header-icon" aria-hidden="true">{icon}</div>
      <div className="workspace-page-header-copy">
        {canGoBack ? (
          <button type="button" className="workspace-page-header-back" onClick={onBack} aria-label={`Torna a ${backLabel}`}>
            <ArrowLeft size={17} />
            <span>{backLabel}</span>
          </button>
        ) : null}
        <span className="workspace-page-header-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  );
}

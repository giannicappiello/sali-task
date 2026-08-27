import { ArrowRight, ArrowUpRight, LayoutGrid, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import useBackNavigation from "../hooks/useBackNavigation";
import WorkspacePageHeader from "./WorkspacePageHeader";
import "./module-container-layout.css";

export default function ModuleContainerLayout({
  icon: HeroIcon = LayoutGrid,
  eyebrow = "Modulo Workspace",
  title,
  description,
  items = [],
  loading = false,
  loadingLabel = "Caricamento aree disponibili...",
  error = "",
  onRetry,
  ariaLabel = "Aree disponibili",
  openLabel = "Apri area",
  emptyTitle = "Nessuna area disponibile",
  emptyDescription = "Non risultano aree disponibili per questo utente.",
  backFallback = "/home",
  backLabel = "Indietro",
  showBack = true,
  children = null,
}) {
  const goBack = useBackNavigation(backFallback);

  return (
    <div className="module-container-page">
      <WorkspacePageHeader
        className="module-container-hero"
        icon={<HeroIcon size={31} />}
        backLabel={showBack ? backLabel : ""}
        onBack={showBack ? goBack : undefined}
        eyebrow={eyebrow}
        title={title}
        description={description}
      />

      {error ? <div className="module-container-message error"><span>{error}</span>{onRetry ? <button type="button" onClick={onRetry}><RefreshCw size={16} />Riprova</button> : null}</div> : null}
      {loading ? <div className="module-container-loading"><div className="auth-spinner" /><span>{loadingLabel}</span></div> : null}

      {!loading && !error && items.length ? (
        <section className="module-container-grid" aria-label={ariaLabel}>
          {items.map((item) => {
            const ItemIcon = item.icon || HeroIcon;
            const label = typeof openLabel === "function" ? openLabel(item) : openLabel;
            const actionContent = <>{label} {item.external ? <ArrowUpRight size={17} /> : <ArrowRight size={17} />}</>;
            return (
              <article className="module-container-card" key={item.code}>
                <div className="module-container-card-icon"><ItemIcon size={23} /></div>
                <div className="module-container-card-copy"><h2>{item.name}</h2><p>{item.description || "Apri questa area del modulo."}</p></div>
                {item.onOpen
                  ? <button type="button" onClick={item.onOpen} aria-label={`${label} ${item.name}`}>{actionContent}</button>
                  : <Link to={item.to} state={item.state} target={item.external ? "_blank" : undefined} rel={item.external ? "noopener noreferrer" : undefined} aria-label={`${label} ${item.name}${item.external ? " in una nuova scheda" : ""}`}>{actionContent}</Link>}
              </article>
            );
          })}
        </section>
      ) : null}

      {!loading && !error && children ? <div className="module-container-content">{children}</div> : null}

      {!loading && !error && !items.length && !children ? <div className="module-container-empty"><HeroIcon size={34} /><h2>{emptyTitle}</h2><p>{emptyDescription}</p></div> : null}
    </div>
  );
}

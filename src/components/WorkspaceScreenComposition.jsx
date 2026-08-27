import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { normalizeWorkspaceLayout } from "./workspaceScreenLayoutConfig";
import "./workspace-screen-composition.css";

function safeDestination(value) {
  const destination = String(value || "").trim();
  return destination.startsWith("/") || /^https:\/\//i.test(destination) ? destination : "";
}

function DestinationLink({ href, className, children, ariaLabel }) {
  const destination = safeDestination(href);
  if (!destination) return null;
  if (destination.startsWith("/")) return <Link className={className} to={destination} aria-label={ariaLabel}>{children}</Link>;
  return <a className={className} href={destination} target="_blank" rel="noreferrer" aria-label={ariaLabel}>{children}<ExternalLink size={15} aria-hidden="true" /></a>;
}

export default function WorkspaceScreenComposition({ layout, children, preview = false, requireSystemContent = Boolean(children) }) {
  const normalized = normalizeWorkspaceLayout(layout, { requireSystemContent });
  return <div className={`workspace-composition ${preview ? "is-preview" : ""}`}>
    {normalized.blocks.map((block) => {
      const className = `workspace-composition-block width-${block.width}`;
      if (block.type === "system-content") return <div className={`${className} system-content`} key={block.id}>{children}</div>;
      if (block.type === "text") return <section className={className} key={block.id}><h2>{block.title || "Titolo"}</h2>{block.text ? <p>{block.text}</p> : null}</section>;
      if (block.type === "panel") return <section className={`${className} workspace-composition-panel`} key={block.id}><h2>{block.title || "Pannello"}</h2>{block.text ? <p>{block.text}</p> : null}</section>;
      if (block.type === "button") return <div className={`${className} workspace-composition-action`} key={block.id}><DestinationLink href={block.href} className={block.variant === "secondary" ? "secondary-action" : block.variant === "danger" ? "danger-action" : "primary-action"} ariaLabel={`${block.label || "Apri"}: ${block.href || "destinazione non configurata"}`}>{block.label || "Pulsante"}</DestinationLink></div>;
      if (block.type === "links") return <nav className={`${className} workspace-composition-links`} aria-label={block.title || "Collegamenti"} key={block.id}>{block.title ? <h2>{block.title}</h2> : null}<div>{(block.items || []).map((item, index) => <DestinationLink href={item.href} className="secondary-action" ariaLabel={`${item.label || "Collegamento"}: ${item.href || "destinazione non configurata"}`} key={`${block.id}-${index}`}>{item.label || "Collegamento"}</DestinationLink>)}</div></nav>;
      if (block.type === "divider") return <div className={`${className} workspace-composition-divider`} aria-hidden="true" key={block.id} />;
      return null;
    })}
  </div>;
}

import { useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { MODULE_ICON_OPTIONS } from "../../config/moduleIcons";
import { filterKeepingSelected } from "./workspaceCatalog";

export function WorkspaceQuickSearch({ value, onChange, placeholder = "Cerca per nome, codice, descrizione, area, origine o route", label = "Ricerca rapida", className = "" }) {
  const id = useId();
  return <label className={`workspace-quick-search ${className}`.trim()} htmlFor={id}><span className="sr-only">{label}</span><Search size={17} aria-hidden="true"/><input id={id} type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={label}/></label>;
}

export function WorkspaceAssociationFilter({ value, onChange }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} aria-label="Filtra per associazione"><option value="all">Tutte le associazioni</option><option value="associated">Associati</option><option value="unassociated">Non associati</option></select>;
}

export function WorkspaceIconPicker({ value, onChange, disabled = false, description = "Scegli il simbolo identificativo." }) {
  const [search, setSearch] = useState("");
  const options = useMemo(() => filterKeepingSelected(
    MODULE_ICON_OPTIONS,
    search,
    ["code", "label", (item) => item.keywords?.join(" ")],
    value ? [value] : [],
    (item) => item.code,
  ), [search, value]);
  return <fieldset className="module-icon-picker wide"><legend>Icona</legend><p>{description}</p><WorkspaceQuickSearch value={search} onChange={setSearch} label="Ricerca icona" placeholder="Ricerca icona per nome o parola chiave" className="icon-quick-search"/><div>{options.map(({ code,label,Icon }) => <button key={code} type="button" disabled={disabled} className={value===code?"selected":""} aria-pressed={value===code} title={label} onClick={() => onChange(code)}><Icon size={21}/><span>{label}</span></button>)}</div>{options.length === 0 ? <p className="workspace-empty-result">Nessuna icona corrisponde alla ricerca.</p> : null}</fieldset>;
}

export function AssociationBadge({ associated, orphanLabel = "Elemento orfano" }) {
  return <span className={`association-badge ${associated ? "associated" : "unassociated"}`}>{associated ? "Associato" : orphanLabel}</span>;
}

export function AssociationLinks({ items, getKey, getLabel, onOpen, limit = 3, empty = "Nessuna associazione" }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, limit);
  if (!items.length) return <span className="association-empty">{empty}</span>;
  return <span className="association-links">{visible.map((item) => <button type="button" key={getKey(item)} onClick={() => onOpen(item)}>{getLabel(item)}</button>)}{items.length > limit ? <button type="button" className="association-more" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? "Mostra meno" : `+ ${items.length - limit} associazioni`}</button> : null}</span>;
}

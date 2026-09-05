import { Link } from "react-router-dom";
import { CalendarClock, CheckSquare, Link2, LockKeyhole, MessageSquare, Paperclip } from "lucide-react";

const COLUMNS = [
  ["da_evadere", "Da fare"],
  ["in_lavorazione", "In lavorazione"],
  ["bloccata", "Bloccata"],
  ["in_valutazione", "In verifica"],
  ["evaso", "Completata"],
];

const normalize = (value) => String(value || "").trim().toLowerCase().replaceAll(" ", "_");
const completed = (item) => ["evaso", "evasa", "completato", "completata", "chiuso", "chiusa"].includes(normalize(item.stato)) || Boolean(item.completato_at);

function effectiveStatus(item, allItems) {
  if (completed(item)) return "evaso";
  const blocker = item.bloccante_id ? allItems.find((candidate) => candidate.id === item.bloccante_id) : null;
  if (normalize(item.stato) === "bloccata" || (blocker && !completed(blocker))) return "bloccata";
  if (["in_lavorazione", "in_valutazione"].includes(normalize(item.stato))) return normalize(item.stato);
  return "da_evadere";
}

export default function WorkspaceTaskKanban({ items, onMove, onOpen }) {
  return <div className="workspace-task-kanban" aria-label="Kanban task Workspace">
    {COLUMNS.map(([status, label]) => {
      const columnItems = items.filter((item) => effectiveStatus(item, items) === status);
      return <section key={status} className={`panel workspace-task-column status-${status}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onMove(event.dataTransfer.getData("text/plain"), status)}>
        <header className="panel-header"><h3>{label}</h3><span className="filter-count" aria-label={`${columnItems.length} task`}>{columnItems.length}</span></header>
        <div className="workspace-task-list">{columnItems.map((item) => <article className="workspace-task-card" key={item.id} draggable={status !== "bloccata"} onDragStart={(event) => event.dataTransfer.setData("text/plain", item.id)}>
          <button className="workspace-task-open" type="button" onClick={() => onOpen(item)}><strong>{item.titolo}</strong></button>
          {item.crm_customer_key ? <Link className="secondary-action workspace-task-link" to={item.crm_customer_name === "DIRECT" ? "/crm/brand-direct" : `/crm/conto-terzi/clienti/${encodeURIComponent(item.crm_customer_key)}`}><Link2 size={13} />{item.crm_customer_name || "Cliente"}</Link> : null}
          {item.crm_opportunity_id ? <Link className="secondary-action workspace-task-link" to={`/crm/conto-terzi/pipeline/${item.crm_opportunity_id}`}><Link2 size={13} />Apri opportunità CRM</Link> : null}
          <small>{item.v4_progetti?.titolo || "Attività senza progetto"}</small>
          <small>{item.planningDepartments?.map((department) => department.nome).join(", ") || item.reparti?.nome || "Reparto non indicato"}</small>
          <small>{item.responsabile ? `${item.responsabile.nome || ""} ${item.responsabile.cognome || ""}`.trim() : "Responsabile non assegnato"}</small>
          <small><CalendarClock size={13} />{item.deadline || "Senza deadline"} · {item.priorita || "normale"}</small>
          <footer><span title="Checklist e reparti" aria-label="Checklist e reparti"><CheckSquare size={13} />{item.planningDepartments?.length || ""}</span><span title="Allegati disponibili nel dettaglio task" aria-label="Allegati"><Paperclip size={13} />{Number.isFinite(item.attachment_count) ? item.attachment_count : ""}</span><span title="Commenti disponibili nel dettaglio task" aria-label="Commenti"><MessageSquare size={13} />{Number.isFinite(item.comment_count) ? item.comment_count : ""}</span>{status === "bloccata" ? <span className="status-badge workspace-task-blocked" title="Task bloccata"><LockKeyhole size={13} />Bloccata</span> : null}</footer>
        </article>)}</div>
      </section>;
    })}
  </div>;
}

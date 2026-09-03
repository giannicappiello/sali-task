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
      return <section key={status} className={`workspace-task-column status-${status}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onMove(event.dataTransfer.getData("text/plain"), status)}>
        <header><strong>{label}</strong><span>{columnItems.length}</span></header>
        <div>{columnItems.map((item) => <article key={item.id} draggable={status !== "bloccata"} onDragStart={(event) => event.dataTransfer.setData("text/plain", item.id)}>
          <button type="button" onClick={() => onOpen(item)}><strong>{item.titolo}</strong></button>
          {item.crm_customer_key ? <Link to={`/crm/conto-terzi/clienti/${encodeURIComponent(item.crm_customer_key)}`}><Link2 size={13} />{item.crm_customer_key}</Link> : null}
          {item.crm_opportunity_id ? <Link to={`/crm/conto-terzi/opportunita/${item.crm_opportunity_id}`}><Link2 size={13} />Apri opportunità CRM</Link> : null}
          <small>{item.v4_progetti?.titolo || "Attività senza progetto"}</small>
          <small>{item.planningDepartments?.map((department) => department.nome).join(", ") || item.reparti?.nome || "Reparto non indicato"}</small>
          <small>{item.responsabile ? `${item.responsabile.nome || ""} ${item.responsabile.cognome || ""}`.trim() : "Responsabile non assegnato"}</small>
          <small><CalendarClock size={13} />{item.deadline || "Senza deadline"} · {item.priorita || "normale"}</small>
          <footer><span title="Checklist e reparti" aria-label="Checklist e reparti"><CheckSquare size={13} />{item.planningDepartments?.length || ""}</span><span title="Allegati disponibili nel dettaglio task" aria-label="Allegati"><Paperclip size={13} />{Number.isFinite(item.attachment_count) ? item.attachment_count : ""}</span><span title="Commenti disponibili nel dettaglio task" aria-label="Commenti"><MessageSquare size={13} />{Number.isFinite(item.comment_count) ? item.comment_count : ""}</span>{status === "bloccata" ? <span title="Task bloccata"><LockKeyhole size={13} /></span> : null}</footer>
        </article>)}</div>
      </section>;
    })}
  </div>;
}

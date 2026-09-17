import { Building2, UsersRound } from "lucide-react";
import { canSelectChatUser, chatDepartmentIds, chatUserName, isChatLeader, isChatAdmin } from "./chatDirectory.js";

export default function ChatDirectory({ tab, users, departments, actor, selecting, selectedIds, onToggleSelection, onToggleUser, onDirect, onDepartment, onCreateGroup, busy, loading, error, onRetry }) {
  const ownIds = chatDepartmentIds(actor);
  const admin = isChatAdmin(actor);
  const selected = users.filter((user) => selectedIds.includes(user.id));
  const visibleDepartments = tab === "department" ? departments.filter((department) => ownIds.includes(department.id)) : departments;

  function person(user, departmentId) {
    const name = chatUserName(user);
    const self = user.id === actor?.id;
    const checked = selectedIds.includes(user.id);
    const available = checked || canSelectChatUser(actor, user, selecting ? selected : []);
    return <div className="directory-person" key={`${departmentId}-${user.id}`}>
      {selecting && !self && <input type="checkbox" aria-label={`Seleziona ${name}`} checked={checked} disabled={busy || !available} onChange={() => onToggleUser(user.id)} />}
      <button type="button" disabled={busy || self || !available} onClick={() => selecting ? onToggleUser(user.id) : onDirect(user)}>
        <span className="directory-avatar">{name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
        <span>{name}{self ? " (tu)" : ""}<small>{user.ruoli?.nome || "Collaboratore"}</small></span>
      </button>
    </div>;
  }

  return <>
    <div className="directory-selection-tools"><button type="button" disabled={busy || loading || Boolean(error)} onClick={onToggleSelection}>{selecting ? "Annulla selezione" : "Seleziona persone"}</button></div>
    <div className="directory-content">
      <h3>{tab === "department" ? "Il mio reparto" : "Organigramma aziendale"}</h3>
      {loading ? <p className="messages-empty">Caricamento persone...</p> : error ? <div role="alert"><p>{error}</p><button type="button" className="secondary-action" onClick={onRetry}>Riprova</button></div> : <>
        {!visibleDepartments.length && <p className="messages-empty">Nessun reparto assegnato.</p>}
        {visibleDepartments.map((department) => {
          const own = ownIds.includes(department.id);
          const members = users.filter((user) => chatDepartmentIds(user).includes(department.id));
          const visible = tab === "department" ? members : members.filter((user) => user.id !== actor?.id && (admin || isChatLeader(user) || isChatAdmin(user)));
          return <div className="directory-department" key={department.id}>
            <button className="directory-department-button" type="button" disabled={busy || selecting || (!admin && !own && !isChatLeader(actor)) || !members.some((user) => user.id !== actor?.id)} onClick={() => onDepartment(department)}>
              {tab === "department" ? <UsersRound size={17} /> : <Building2 size={17} />}<span>{department.nome}<small>{own ? (tab === "department" ? ` · ${members.length} persone` : " · Il tuo reparto") : ""}</small></span>
            </button>
            <div className="directory-branch">{visible.map((user) => person(user, department.id))}{!visible.length && <p className="directory-empty">{admin ? 'Nessun altro utente assegnato.' : 'Nessun responsabile o direttore assegnato.'}</p>}</div>
          </div>;
        })}
        {tab === 'organization' && users.some(user => !chatDepartmentIds(user).length && user.id !== actor?.id && (admin || isChatAdmin(user))) && <div className="directory-department"><h4>Senza reparto</h4><div className="directory-branch">{users.filter(user => !chatDepartmentIds(user).length && user.id !== actor?.id && (admin || isChatAdmin(user))).map(user => person(user, 'unassigned'))}</div></div>}
      </>}
    </div>
    {selecting && <div className="directory-selection" aria-live="polite"><span>{selectedIds.length} persone selezionate</span>{selectedIds.length >= 2 && <button type="button" className="primary-action" disabled={busy} onClick={onCreateGroup}>{busy ? "Creazione..." : "Crea gruppo"}</button>}</div>}
    <p className="directory-policy">{admin ? 'Come amministratore puoi contattare tutti gli utenti.' : isChatLeader(actor) ? "Puoi contattare il tuo reparto, gli amministratori e i responsabili e direttori degli altri reparti." : "Puoi chattare con i membri del tuo reparto e con gli amministratori."}{selecting && selectedIds.length > 0 ? " Puoi aggiungere solo persone compatibili con tutti i membri selezionati." : ""}</p>
  </>;
}

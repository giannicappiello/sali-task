export const chatUserName = (user) => `${user?.nome || ""} ${user?.cognome || ""}`.trim() || "Utente";

export const isChatAdmin = user => user?.attivo !== false && user?.ruoli?.amministratore_workspace === true;

// The directory's flags are authoritative, including customers with a staff-like role.
export const isChatCustomer = user => user?.is_customer === true
  || /^(cliente|customer)(\s|$)/i.test(user?.ruoli?.nome?.trim() || '');

export const isChatTeamMember = user => user?.attivo !== false && !isChatCustomer(user)
  && (typeof user?.is_team_member === 'boolean' ? user.is_team_member
    : user?.ruoli?.nome?.trim().toLowerCase() !== 'collaboratore esterno');

export function isChatLeader(user) {
  return /^(responsabile|direttore|direttrice)(\s|$)/i.test(user?.ruoli?.nome?.trim() || "")
    || user?.ruoli?.nome?.trim().toLowerCase() === "direzione";
}

export function chatDepartmentIds(user) {
  return [...new Set([user?.reparto_id, ...(user?.utenti_reparti || []).map((row) => row.reparto_id)].filter(Boolean))];
}

export function canChatTogether(a, b) {
  if (!a?.id || !b?.id || a.attivo === false || b.attivo === false) return false;
  if (a.id === b.id) return true;
  if (isChatCustomer(a) || isChatCustomer(b)) {
    return isChatCustomer(a) ? isChatTeamMember(b) : isChatTeamMember(a);
  }
  return a.id === b.id || isChatAdmin(a) || isChatAdmin(b) || (isChatLeader(a) && isChatLeader(b))
    || chatDepartmentIds(a).some((id) => chatDepartmentIds(b).includes(id));
}

export function canSelectChatUser(actor, candidate, selected = []) {
  return candidate.id !== actor?.id && canChatTogether(actor, candidate)
    && selected.every((user) => canChatTogether(user, candidate));
}

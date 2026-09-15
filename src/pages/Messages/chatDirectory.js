export const chatUserName = (user) => `${user?.nome || ""} ${user?.cognome || ""}`.trim() || "Utente";

export function isChatLeader(user) {
  return /^(responsabile|direttore|direttrice)(\s|$)/i.test(user?.ruoli?.nome?.trim() || "")
    || user?.ruoli?.nome?.trim().toLowerCase() === "direzione";
}

export function chatDepartmentIds(user) {
  return [...new Set([user?.reparto_id, ...(user?.utenti_reparti || []).map((row) => row.reparto_id)].filter(Boolean))];
}

export function canChatTogether(a, b) {
  if (!a?.id || !b?.id || a.attivo === false || b.attivo === false) return false;
  return a.id === b.id || (isChatLeader(a) && isChatLeader(b))
    || chatDepartmentIds(a).some((id) => chatDepartmentIds(b).includes(id));
}

export function canSelectChatUser(actor, candidate, selected = []) {
  return candidate.id !== actor?.id && canChatTogether(actor, candidate)
    && selected.every((user) => canChatTogether(user, candidate));
}

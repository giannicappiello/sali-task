// Pure resolver. The caller loads current organization and checks each recipient's
// source authorization again before rendering their individually scoped report.
export function resolveRecipients({ departmentId, policy, users, memberships }) {
 const active = users.filter(u => u.attivo !== false), ids = new Set(), gaps = [];
 if (policy.workspaceAdmins) for (const user of active) if (user.ruoli?.amministratore_workspace === true) ids.add(user.id);
 if (policy.departmentManager && departmentId) {
  const override = policy.departmentOverrides?.[departmentId];
  if (override) ids.add(override);
  else {
   const members = new Set(memberships.filter(m => m.reparto_id === departmentId).map(m => m.utente_id));
   const managers = [...new Set(active.filter(u => members.has(u.id)).map(u => u.responsabile_utente_id).filter(Boolean))];
   if (managers.length === 1) ids.add(managers[0]);
   else gaps.push({ departmentId, code: managers.length ? 'DEPARTMENT_MANAGER_AMBIGUOUS' : 'DEPARTMENT_MANAGER_NOT_CONFIGURED' });
  }
 } else if (policy.departmentManager) gaps.push({ code: 'DEPARTMENT_NOT_IDENTIFIED' });
 for (const id of policy.additionalUserIds || []) ids.add(id);
 const emails = new Set(), recipients = [];
 for (const id of ids) {
  const user = active.find(u => u.id === id);
  if (!user || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email || '')) { gaps.push({ userId: id, code: 'RECIPIENT_INACTIVE_OR_EMAIL_MISSING' }); continue; }
  const email = user.email.trim().toLowerCase();
  if (emails.has(email)) continue;
  emails.add(email); recipients.push({ userId: id, email, administrator: user.ruoli?.amministratore_workspace === true });
 }
 return { recipients, gaps, ready: gaps.length === 0 && recipients.length > 0 };
}

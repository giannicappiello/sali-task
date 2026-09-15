export function isPhaseParticipant(phase, { actorId, departmentIds = [], readAll = false, phaseDepartments = [] }) {
  if (!phase) return false;
  if (readAll) return true;
  if (actorId && (phase.creato_da === actorId || phase.assegnato_a === actorId)) return true;
  const involved = [phase.reparto_id, ...phaseDepartments.filter((row) => row.fase_id === phase.id).map((row) => row.reparto_id)];
  return involved.some((id) => id && departmentIds.includes(id));
}

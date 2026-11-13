export const CLOSED_ACTIVITY_STATES = new Set([
  "evaso", "evasa", "completato", "completata", "chiuso", "chiusa", "annullato", "annullata",
]);

export function isClosedTask(task) {
  const state = String(task?.stato || "").trim().toLowerCase().replaceAll(" ", "_");
  return Boolean(task?.completato_at) || CLOSED_ACTIVITY_STATES.has(state);
}

export function isArchivedProject(project, tasks = []) {
  const state = String(project?.stato || "").trim().toLowerCase().replaceAll(" ", "_");
  return CLOSED_ACTIVITY_STATES.has(state) || (tasks.length > 0 && tasks.every(isClosedTask));
}

export function matchesProjectStatus(project, tasks, status, today) {
  const archived = isArchivedProject(project, tasks);
  if (status === "completati") return archived;
  if (status === "aperti") return !archived;
  if (status === "oggi" || status === "scaduti") {
    return !archived && tasks.some(task => !isClosedTask(task) && task.deadline
      && (status === "oggi" ? task.deadline === today : task.deadline < today));
  }
  return true;
}

export function archivedProjectHref(projectId, archiveSearch = "") {
  const back = `/activities/archive${archiveSearch ? `?${archiveSearch}` : ""}`;
  return `/activities/projects?${new URLSearchParams({ project: projectId, returnTo: back })}`;
}

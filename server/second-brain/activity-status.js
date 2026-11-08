// Mirror ActivityArchive, not the raw status dropdown or department checkboxes.
const CLOSED_STATES = new Set(['evaso', 'evasa', 'completato', 'completata', 'chiuso', 'chiusa', 'annullato', 'annullata']);
const isClosedState = value => CLOSED_STATES.has(String(value || '').trim().toLowerCase().replaceAll(' ', '_'));
export const isArchivedTask = task => Boolean(task.completato_at) || isClosedState(task.stato);

export function projectArchiveStatus(project, phases) {
  const closed = isClosedState(project.stato) || (phases.length > 0 && phases.every(isArchivedTask));
  return {
    ...project,
    stato_archivio: closed ? 'chiuso' : 'aperto',
    archiviato_secondo_criterio_ui: closed,
    criterio_archivio: isClosedState(project.stato) ? 'stato_progetto' : closed ? 'tutte_le_fasi_visibili_concluse' : 'non_concluso',
    fasi_visibili: phases.length,
    fasi_visibili_concluse: phases.filter(isArchivedTask).length,
    chiusura_archivio: closed ? (phases.map(task => task.completato_at || task.updated_at).filter(Boolean).sort().at(-1) || project.updated_at || project.deadline || null) : null,
  };
}

// Use only the caller's RLS client and only projects already in the result page.
// Exact counts protect against lower server row caps and incomplete aggregation.
export async function addActivityStatus(scoped, dataset, rows) {
  if (dataset === 'tasks') return rows.map(task => ({ ...task, stato_archivio: isArchivedTask(task) ? 'chiuso' : 'aperto' }));
  if (dataset !== 'projects' || !rows.length) return rows;
  const ids = rows.map(row => row.id), phases = [];
  let expected;
  do {
    const { data, error, count } = await scoped.from('v4_fasi_progetto')
      .select('id,progetto_id,stato,completato_at,updated_at', { count: 'exact' })
      .in('progetto_id', ids).order('id').range(phases.length, phases.length + 499);
    if (error) throw error;
    if (!Number.isSafeInteger(count) || count < 0 || count > 10000 || (expected !== undefined && count !== expected)) {
      throw new Error('Copertura fasi non verificabile o variata: ripetere la ricerca per singolo progetto.');
    }
    expected = count;
    if ((!data?.length && phases.length < count) || phases.length + (data?.length || 0) > count) {
      throw new Error('Lettura fasi incompleta: stato archivio non disponibile.');
    }
    phases.push(...(data || []));
  } while (phases.length < expected);
  if (new Set(phases.map(phase => phase.id)).size !== phases.length) throw new Error('Fasi cambiate durante la paginazione: ripetere la ricerca.');
  const byProject = new Map(ids.map(id => [id, []]));
  phases.forEach(phase => byProject.get(phase.progetto_id)?.push(phase));
  return rows.map(project => projectArchiveStatus(project, byProject.get(project.id)));
}

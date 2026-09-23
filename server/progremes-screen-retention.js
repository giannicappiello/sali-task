// Workspace owns menu composition. A reduced MES catalogue is not an
// administrator instruction to disable an active screen used by a local menu.
export function missingProgremesScreens(existing, imported, links, modules) {
  const importedCodes = new Set(imported.map(screen => screen.codice));
  const activeModules = new Set(modules.filter(module => module.attivo === true).map(module => module.codice));
  const assigned = new Set(links.filter(link => link.visibile_menu === true && activeModules.has(link.modulo_codice)).map(link => link.schermata_codice));
  const missing = existing.filter(screen => screen.metadati?.catalog_source === 'progremes_catalog' && !importedCodes.has(screen.codice));
  return {
    retained: missing.filter(screen => screen.attiva === true && assigned.has(screen.codice)).map(screen => screen.codice),
    removed: missing.filter(screen => screen.attiva !== true || !assigned.has(screen.codice)).map(screen => screen.codice),
  };
}

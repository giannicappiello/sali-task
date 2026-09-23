// An explicitly restored Workspace screen may still be absent from the MES
// catalog until the server-side catalog deletion has been reversed. Preserve
// its technical module and existing permissions during that interval.
export function removedProgremesModules(existing, importedCodes, screens) {
  const retained = new Set(screens
    .filter(screen => screen.attiva === true && screen.metadati?.catalog_source === 'workspace_restored_screen')
    .map(screen => screen.metadati.external_module_code)
    .filter(Boolean));
  return existing.filter(item => !importedCodes.includes(item.codice) && !retained.has(item.codice))
    .map(item => item.codice);
}

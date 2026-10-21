function validWorkspacePath(path) {
  return typeof path === "string" && path.startsWith("/") && path !== "/home";
}

export function resolveCatalogModuleDestination(module, template, screens = [], screenLinks = []) {
  if (validWorkspacePath(module?.percorso)) return module.percorso;

  const screensByCode = new Map(screens.map((screen) => [screen.codice, screen]));
  const linkedScreens = screenLinks
    .filter((link) => link.modulo_codice === module?.codice && link.visibile_menu !== false)
    .toSorted((left, right) => {
      if (left.predefinita !== right.predefinita) return left.predefinita ? -1 : 1;
      return (left.ordine ?? Number.MAX_SAFE_INTEGER) - (right.ordine ?? Number.MAX_SAFE_INTEGER);
    });
  const catalogDestination = linkedScreens
    .map((link) => screensByCode.get(link.schermata_codice)?.percorso)
    .find(validWorkspacePath);

  if (catalogDestination) return catalogDestination;
  return validWorkspacePath(template?.path) ? template.path : "";
}

// Pass only screens already filtered for the current user's access.
export function initialModuleScreen(links, screens) {
  const initial = links.find(link => link.predefinita && link.visibile_menu !== false);
  if (!initial) return null;
  return screens.find(screen => screen.codice === initial.schermata_codice) || null;
}

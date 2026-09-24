const LOCAL_PATHS = new Set(["/produzione/ordini-avanzamento", "/produzione/rdp-workbench", "/produzione/fabbisogni-acquisto", "/produzione/diagnostica", "/revisione-priorita-produzione", "/versioni-piano-produzione", "/rilascio-odl"]);

export function productionInitialPath(visibleSections, screens, links) {
  const initial = links.find(link => link.modulo_codice === 'progremes' && link.visibile_menu && link.predefinita);
  const screen = screens.find(screen => screen.codice === initial?.schermata_codice && screen.attiva);
  if (!screen) return '';
  const section = visibleSections.find(section => section.code === screen.codice
    || (section.workspaceLocal && section.path === screen.percorso?.replace(/\/$/, '')));
  if (!section) return '';
  return section.workspaceLocal ? section.path : `/produzione/${encodeURIComponent(section.code)}`;
}

export function configuredProductionSections(remote, screens, links, { hasPermission, isAdminUser, customerScoped, hasScreenAccess }) {
  const byCode = new Map(screens.filter(s => s.attiva).map(s => [s.codice, s]));
  const remoteByCode = new Map(remote.map(s => [s.code, s]));
  return links.filter(l => l.visibile_menu && l.modulo_codice === "progremes")
    .toSorted((a,b) => a.ordine - b.ordine)
    .flatMap(link => {
      const screen = byCode.get(link.schermata_codice);
      if (!screen) return [];
      if (!hasScreenAccess(screen.codice, "progremes")) return [];
      const path = (screen.percorso || "").replace(/\/$/, "");
      if (!LOCAL_PATHS.has(path)) return remoteByCode.has(screen.codice) ? [remoteByCode.get(screen.codice)] : [];
      if (path.endsWith("/diagnostica") ? !isAdminUser : !hasPermission("rdp.view")) return [];
      if ((path.endsWith("/fabbisogni-acquisto") || ["/revisione-priorita-produzione", "/versioni-piano-produzione", "/rilascio-odl"].includes(path)) && customerScoped) return [];
      return [{ code: path.split("/").at(-1), path, name: path === "/rilascio-odl" ? "Storico ODL" : screen.nome, description: path === "/rilascio-odl" ? "Archivio ODL precedenti. Le lavorazioni correnti si gestiscono per OP e batch." : screen.descrizione, workspaceLocal: true }];
    });
}

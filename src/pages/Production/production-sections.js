const LOCAL_PATHS = new Set(["/produzione/rdp-workbench", "/produzione/fabbisogni-acquisto", "/produzione/diagnostica"]);

export function configuredProductionSections(remote, screens, links, { hasPermission, isAdminUser, customerScoped, hasScreenAccess, hasAreaAccess, hasExplicitScreenGrant }) {
  const byCode = new Map(screens.filter(s => s.attiva).map(s => [s.codice, s]));
  const remoteByCode = new Map(remote.map(s => [s.code, s]));
  return links.filter(l => l.visibile_menu && l.modulo_codice === "progremes")
    .toSorted((a,b) => a.ordine - b.ordine)
    .flatMap(link => {
      const screen = byCode.get(link.schermata_codice);
      if (!screen) return [];
      if (!hasScreenAccess(screen.codice, "progremes") || (!hasAreaAccess(screen.area) && !hasExplicitScreenGrant(screen.codice))) return [];
      const path = (screen.percorso || "").replace(/\/$/, "");
      if (!LOCAL_PATHS.has(path)) return remoteByCode.has(screen.codice) ? [remoteByCode.get(screen.codice)] : [];
      if (path.endsWith("/diagnostica") ? !isAdminUser : !hasPermission("rdp.view")) return [];
      if (path.endsWith("/fabbisogni-acquisto") && customerScoped) return [];
      return [{ code: path.split("/").at(-1), name: screen.nome, description: screen.descrizione, workspaceLocal: true }];
    });
}

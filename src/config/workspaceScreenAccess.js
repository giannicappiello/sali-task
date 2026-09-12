import { screenAreaCodes } from "./workspaceScreenAreas.js";
// Screen grants never mutate the list of enabled modules.
export function screenAccessAllowed({ screen, activeUser, admin, exception, areaAllowed, moduleAllowed }) {
  if (!activeUser || !screen || screen.attiva === false) return false;
  if (admin) return true;
  if (screen.metadati?.admin_only === true) return false;
  if (exception?.decision === "nega") return false;
  if (exception?.decision === "consenti") return true;
  return Boolean((screenAreaCodes(screen).length && areaAllowed) || moduleAllowed);
}

export function screenForPath(screens, pathname) {
  const path = String(pathname || "").replace(/\/$/, "") || "/";
  return screens.filter((screen) => screen.attiva !== false).filter((screen) => {
    const route = String(screen.percorso || "").replace(/\/$/, "") || "/";
    const pattern = route.split("/").map((part) => part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/");
    return new RegExp(`^${pattern}${route === "/" ? "$" : "(?:/|$)"}`).test(path);
  }).toSorted((a, b) => b.percorso.length - a.percorso.length)[0] || null;
}

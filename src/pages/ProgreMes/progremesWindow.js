export const PROGREMES_POPUP_PARAM = "workspaceMesWindow";

export function isProgremesScreenPath(path, origin = "https://workspace.invalid") {
  if (!path) return false;
  try {
    const url = new URL(path, origin);
    if (url.origin !== origin) return false;
    if (url.pathname === "/progremes/accesso" || url.pathname === "/progremes") return true;
    const section = decodeURIComponent(url.pathname.replace(/^\/produzione\//, ""));
    return url.pathname.startsWith("/produzione/") && Boolean(section)
      && !["diagnostica", "rdp-workbench", "fabbisogni-acquisto"].includes(section);
  } catch { return false; }
}

export function progremesWorkspacePath(path) {
  const target = new URL(path, "https://workspace.invalid");
  if (target.origin !== "https://workspace.invalid") throw new Error("Destinazione Workspace non valida.");
  target.searchParams.set(PROGREMES_POPUP_PARAM, "1");
  return `${target.pathname}${target.search}${target.hash}`;
}

export function openProgremesWorkspaceWindow(path, browser = window) {
  const popup = browser.open(progremesWorkspacePath(path), "_blank", "popup,width=1440,height=960");
  if (!popup) throw new Error("Consenti l’apertura di nuove finestre per Workspace e riprova.");
  popup.opener = null;
  return popup;
}

export function requestProgremesWorkspaceWindow(path) {
  window.dispatchEvent(new CustomEvent("workspace:launch-progremes", { detail: { workspacePath: path } }));
}

export function isProgremesFrameMessage(event, frameWindow, origin) {
  return Boolean(frameWindow && event.source === frameWindow && event.origin === origin
    && ["progremes-embedded-ready", "progremes-embedded-auth-error", "progremes-workspace-return"].includes(event.data?.type));
}

export async function requestProgremesNavigation(accessToken, { screenCode = "", search = "", signal, fetcher = fetch } = {}) {
  if (!accessToken) throw new Error("Sessione Workspace non disponibile.");
  const params = new URLSearchParams(search);
  params.delete(PROGREMES_POPUP_PARAM);
  const response = await fetcher("/api/mexal/automation", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "progremes_sso", ...(screenCode ? { screenCode, context: Object.fromEntries(params) } : {}) }),
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.url) throw new Error(payload.error || "Impossibile avviare ProgreMES.");
  const destination = new URL(payload.url);
  if (!["https:", "http:"].includes(destination.protocol)) throw new Error("Destinazione ProgreMES non valida.");
  return destination.href;
}

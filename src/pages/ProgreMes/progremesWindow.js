export const PROGREMES_POPUP_PARAM = "workspaceMesWindow";

export function markProgremesPopup(path) {
  const target = new URL(path, "https://workspace.invalid");
  target.searchParams.set(PROGREMES_POPUP_PARAM, "1");
  return `${target.pathname}${target.search}${target.hash}`;
}

export function isProgremesPopup(search = "") {
  return new URLSearchParams(search).get(PROGREMES_POPUP_PARAM) === "1";
}

export function openPendingProgremesWindow() {
  const popup = window.open("about:blank", "_blank");
  if (!popup) throw new Error("Il browser ha bloccato la nuova finestra. Consenti i popup per Workspace e riprova.");
  popup.opener = null;
  return popup;
}

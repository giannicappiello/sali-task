import { useEffect } from "react";

const closeWords = /\b(annulla|chiudi|indietro|torna)\b|×/i;
const saveWords = /\b(salva|conferma|aggiorna|crea|inserisci|applica|registra|completa|evadi|trasforma)\b/i;

function isVisible(element) {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

function getTopWindow() {
  const explicit = [...document.querySelectorAll(
    '[role="dialog"], .modal-backdrop, .documentation-modal, .global-search-backdrop, .global-search-modal, .task-modal, .config-modal, .product-modal, .user-modal'
  )].filter(isVisible);
  if (explicit.length) return explicit.at(-1);

  const fixedLayers = [...document.querySelectorAll("body *")]
    .filter((element) => isVisible(element) && window.getComputedStyle(element).position === "fixed");
  return fixedLayers.at(-1) || null;
}

function buttonText(button) {
  return `${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.textContent || ""}`.trim();
}

function findButton(container, matcher) {
  return [...container.querySelectorAll("button:not(:disabled), [role='button']:not([aria-disabled='true'])")]
    .reverse()
    .find((button) => matcher.test(buttonText(button)));
}

export default function GlobalWindowShortcuts() {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.defaultPrevented || event.repeat) return;
      if (event.key !== "Escape" && event.key !== "F10") return;

      const activeForm = document.activeElement?.closest?.("form");
      const topWindow = getTopWindow();
      const scope = topWindow || activeForm || document;

      if (event.key === "Escape") {
        const closeButton =
          scope.querySelector?.("[data-shortcut-close], .modal-close") ||
          findButton(scope, closeWords) ||
          scope.querySelector?.(".modal-header button:not(:disabled)");
        if (!closeButton) return;
        event.preventDefault();
        event.stopPropagation();
        closeButton.click();
        return;
      }

      const form = topWindow?.querySelector?.("form") || activeForm || scope.querySelector?.("form");
      if (form && isVisible(form)) {
        event.preventDefault();
        event.stopPropagation();
        form.requestSubmit();
        return;
      }

      const saveButton =
        scope.querySelector?.("[data-shortcut-save]:not(:disabled)") ||
        findButton(scope, saveWords);
      if (!saveButton) return;
      event.preventDefault();
      event.stopPropagation();
      saveButton.click();
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return null;
}

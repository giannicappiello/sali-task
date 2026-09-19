import { lazy, Suspense } from "react";
import { Modal } from "../../features/production-costs/common";
import WorkspaceAccessGuard from "../../components/WorkspaceAccessGuard";
import "./planning-action-modal.css";

const Lifecycle = lazy(() => import("../Production/PlanningLifecycle"));
const Priority = lazy(() => import("../Production/PriorityRevision"));
const destinations = {
  "/rilascio-odl": ["Storico ODL", "produzione.rilascio_odl"],
  "/versioni-piano-produzione": ["Versioni e revisioni del piano", "produzione.versioni_piano"],
  "/revisione-priorita-produzione": ["Anticipa produzione", "produzione.revisione_priorita"],
};

export default function PlanningActionModal({ path, onClose, onNavigate }) {
  const url = new URL(path, window.location.origin);
  const destination = destinations[url.pathname];
  if (!destination) return null;
  const [title, screenCode] = destination;
  function followLink(event) {
    const link = event.target.closest("a[href]");
    if (!link) return;
    const next = new URL(link.href);
    if (next.origin === window.location.origin && next.pathname === "/produzione/progremes.Planning") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (next.origin === window.location.origin && destinations[next.pathname]) {
      event.preventDefault();
      event.stopPropagation();
      onNavigate(next.pathname + next.search);
    }
  }
  return <Modal title={title} onClose={onClose}>
    <div className="planning-action-modal" onClickCapture={followLink}>
      <WorkspaceAccessGuard screenCode={screenCode}>
        <Suspense fallback={<p role="status">Caricamento dati…</p>}>
          {url.pathname === "/revisione-priorita-produzione"
            ? <Priority key={path} compact initialSearch={url.search} />
            : <Lifecycle key={path} compact initialSearch={url.search} release={url.pathname === "/rilascio-odl"} />}
        </Suspense>
      </WorkspaceAccessGuard>
    </div>
  </Modal>;
}

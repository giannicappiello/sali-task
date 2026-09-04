import { useState } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

export default function CrmDeleteProjectButton({ project, canDelete, onDeleted, onError, compact = false }) {
  const [busy, setBusy] = useState(false);
  if (!canDelete || !project?.id) return null;

  async function removeProject() {
    const confirmed = window.confirm(
      `Eliminare definitivamente il progetto commerciale “${project.titolo}”? `
      + "Le attività CRM collegate saranno eliminate. Eventuali progetti e task Workspace saranno conservati e scollegati.",
    );
    if (!confirmed) return;

    setBusy(true);
    const { error } = await supabase.rpc("crm_delete_opportunity", { p_opportunity_id: project.id });
    setBusy(false);
    if (error) {
      onError?.(error.message);
      return;
    }
    await onDeleted?.(project.id);
  }

  return (
    <button
      type="button"
      className={`danger-action crm-delete-project${compact ? " compact" : ""}`}
      onClick={() => void removeProject()}
      disabled={busy}
      aria-label={`Elimina progetto ${project.titolo}`}
    >
      <Trash2 size={15} />{busy ? "Eliminazione..." : "Elimina"}
    </button>
  );
}

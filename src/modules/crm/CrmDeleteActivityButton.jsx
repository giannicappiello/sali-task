import { useState } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

export default function CrmDeleteActivityButton({ activity, canDelete, onDeleted, onError, compact = false }) {
  const [busy, setBusy] = useState(false);
  if (!canDelete || !activity?.id) return null;

  async function removeActivity() {
    const linkedWorkspaceWork = activity.workspace_project_id || activity.workspace_task_id || activity.activity_class;
    const detail = linkedWorkspaceWork
      ? " Il progetto e le task Workspace già generati saranno conservati e scollegati."
      : "";
    if (!window.confirm(`Eliminare definitivamente l’attività “${activity.titolo}”?${detail}`)) return;

    setBusy(true);
    const { error } = await supabase.rpc("crm_delete_activity", { p_activity_id: activity.id });
    setBusy(false);
    if (error) {
      onError?.(error.message);
      return;
    }
    await onDeleted?.(activity.id);
  }

  return (
    <button
      type="button"
      className={`danger-action crm-delete-activity${compact ? " compact" : ""}`}
      onClick={() => void removeActivity()}
      disabled={busy}
      aria-label={`Elimina attività ${activity.titolo}`}
    >
      <Trash2 size={15} />{busy ? "Eliminazione..." : "Elimina"}
    </button>
  );
}

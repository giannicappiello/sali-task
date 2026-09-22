// Use the same effective screen level as the Workspace catalog, including denials.
export const PLANNING_PRODUCTION_SCREEN = "progremes.PlanningProduction";
export async function canOpenPlanningProduction(admin, userId) {
  const { data, error } = await admin.rpc("workspace_screen_level_for_user", {
    target_user_id: userId, target_screen: PLANNING_PRODUCTION_SCREEN,
  });
  if (error) throw Object.assign(new Error("Verifica autorizzazioni pianificazione non disponibile."), { status: 503 });
  return ["lettura", "scrittura", "amministrazione"].includes(data);
}

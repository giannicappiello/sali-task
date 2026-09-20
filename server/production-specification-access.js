const readPaths = new Set(['/specifications', '/specifications/sources', '/specifications/file', '/specifications/history']);
const allowedLevels = new Set(['lettura', 'scrittura', 'gestione', 'completo', 'amministrazione']);
export async function canReadProductionSpecification(admin, profileId, pathname) {
  if (!readPaths.has(pathname)) return false;
  const results = await Promise.all(['progremes.OperatoreConfezionamento', 'progremes.Produzione'].map(screen =>
    admin.rpc('workspace_screen_level_for_user', { target_user_id: profileId, target_screen: screen })));
  for (const result of results) if (result.error) throw result.error;
  return results.some(result => allowedLevels.has(result.data));
}

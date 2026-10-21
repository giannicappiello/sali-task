const normalized = path => String(path || '').replace(/\/$/, '') || '/';

export function exactWorkspaceScreen(screens, pathname) {
  const path = normalized(pathname);
  const literal = screens.find(screen => screen.percorso && normalized(screen.percorso) === path);
  if (literal) return literal;
  const parts = path.split('/');
  return screens.filter(screen => screen.percorso?.includes('/:')).find(screen => {
    const pattern = normalized(screen.percorso).split('/');
    return pattern.length === parts.length && pattern.every((part, index) => part.startsWith(':') ? Boolean(parts[index]) : part === parts[index]);
  });
}

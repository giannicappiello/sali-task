import { createContext, useContext, useEffect, useId } from "react";

export const WorkspaceChromeContext = createContext(null);

// The route key prevents an outgoing screen from replacing the new title.
export function useWorkspaceChrome({ title, description, backLabel, onBack, priority = 0 } = {}) {
  const context = useContext(WorkspaceChromeContext);
  const owner = useId();
  const register = context?.register;
  const route = context?.route;
  useEffect(() => {
    if (!register || !title) return;
    return register(owner, { route, title, description, backLabel, onBack, priority });
  }, [register, route, owner, title, description, backLabel, onBack, priority]);
  return Boolean(context);
}

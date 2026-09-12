import { screenAreaCodes } from "./workspaceScreenAreas.js";

// Modules and screens have independent assignments but the same catalog format.
export const moduleAreaCodes = screenAreaCodes;
export function moduleMatchesArea(module, areaCode) {
  return areaCode === "all" || moduleAreaCodes(module).includes(areaCode);
}

// A missing array is a legacy catalog response; an explicit array replaces it.
export function screenAreaCodes(screen) {
  const values = Array.isArray(screen?.aree) ? screen.aree : [screen?.area];
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

export function screenMatchesArea(screen, areaCode) {
  return areaCode === "all" || screenAreaCodes(screen).includes(areaCode);
}

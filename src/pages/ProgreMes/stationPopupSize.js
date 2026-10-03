export function stationPopupSize({ width, height }, { width: availableWidth, height: availableHeight }, chromeHeight) {
  if (![width, height, availableWidth, availableHeight, chromeHeight].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  if (availableWidth >= 900) {
    return { width: Math.min(1440, availableWidth - 18), height: Math.min(height + chromeHeight + 2, availableHeight - 18) };
  }
  const scale = Math.max(0, Math.min(1, 800 / width, (availableWidth - 18) / width, (availableHeight - 18 - chromeHeight) / height));
  return { width: width * scale + 2, height: height * scale + chromeHeight + 2 };
}

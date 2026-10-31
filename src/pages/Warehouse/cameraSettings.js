export const cameraVideoConstraints = deviceId => ({
  ...(deviceId ? {deviceId:{exact:deviceId}} : {facingMode:{ideal:"environment"}}),
  width:{ideal:1920}, height:{ideal:1080}, resizeMode:{ideal:"none"},
});

export function cameraCapabilities(track) {
  try { return track.getCapabilities?.() || {}; } catch { return {}; }
}

export function numericCameraRange(value) {
  return Number.isFinite(value?.min) && Number.isFinite(value?.max) && value.max > value.min
    ? {min:value.min,max:value.max,step:value.step > 0 ? value.step : (value.max-value.min)/100} : null;
}

// Optional controls must never prevent opening a working video stream.
export async function configureCameraFocus(track) {
  const capabilities = cameraCapabilities(track);
  for (const mode of ["continuous", "single-shot"]) {
    if (!capabilities.focusMode?.includes(mode)) continue;
    try { await track.applyConstraints({advanced:[{focusMode:mode}]}); return true; }
    catch { /* Try the other mode if the driver rejects continuous focus. */ }
  }
  return false;
}

// Only switch an automatically chosen lens when its label clearly identifies
// an unsuitable lens and another rear lens is explicitly identifiable.
export function preferredRearCamera(devices, currentId, currentLabel = "") {
  const unsuitable = /ultra|telephoto|teleob|front|anteriore|selfie/i;
  const rear = /back|rear|posteriore|environment/i;
  const current = devices.find(device => device.deviceId === currentId);
  if (!unsuitable.test(current?.label || currentLabel)) return null;
  return devices.find(device => device.kind === "videoinput" && device.deviceId !== currentId &&
    rear.test(device.label) && !unsuitable.test(device.label)) || null;
}

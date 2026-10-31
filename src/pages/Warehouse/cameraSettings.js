export const cameraVideoConstraints = deviceId => ({
  ...(deviceId ? {deviceId:{exact:deviceId}} : {facingMode:{ideal:"environment"}}),
  width:{ideal:1920}, height:{ideal:1080}, resizeMode:{ideal:"none"},
});

export function cameraCapabilities(track) {
  try { return track.getCapabilities?.() || {}; } catch { return {}; }
}

// A touch is mapped to the actual image, excluding object-fit:contain bars.
export function focusPointInPreview(x, y, rect, width, height) {
  if (!rect.width || !rect.height || !width || !height) return null;
  const scale = Math.min(rect.width/width, rect.height/height);
  const imageWidth=width*scale, imageHeight=height*scale;
  const px=(x-rect.left-(rect.width-imageWidth)/2)/imageWidth;
  const py=(y-rect.top-(rect.height-imageHeight)/2)/imageHeight;
  return px>=0 && px<=1 && py>=0 && py<=1 ? {x:px,y:py} : null;
}

// Continuous autofocus owns the preview; touch focus requests a one-shot sweep
// at the selected sensor point, with a fallback if the driver rejects the point.
export async function configureCameraFocus(track, point = null) {
  const capabilities = cameraCapabilities(track);
  const modes = point ? ["single-shot", "continuous"] : ["continuous", "single-shot"];
  for (const mode of modes) {
    if (!capabilities.focusMode?.includes(mode)) continue;
    const pointConstraints = point ? {pointsOfInterest:[point]} : {};
    try { await track.applyConstraints({advanced:[{focusMode:mode,...pointConstraints}]}); return true; }
    catch {
      if (point) {
        try { await track.applyConstraints({advanced:[{focusMode:mode}]}); return true; } catch { /* Try another supported mode. */ }
      }
    }
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

// Samsung may expose several rear lenses with generic labels. If the default
// has fixed focus, inspect rear alternatives rather than requiring a lens menu.
export async function openBarcodeCamera(mediaDevices, cancelled = () => false) {
  let stream;
  const stop = () => stream?.getTracks().forEach(track=>track.stop());
  const open = async id => {
    stream=await mediaDevices.getUserMedia({audio:false,video:cameraVideoConstraints(id)});
    if(cancelled()){stop();return false;}
    return true;
  };
  try {
    if(!await open(""))return null;
    let devices=[];
    try{devices=await mediaDevices.enumerateDevices();}catch{return stream;}
    if(cancelled()){stop();return null;}
    const initial=stream.getVideoTracks()[0],initialId=initial.getSettings?.().deviceId;
    const preferred=preferredRearCamera(devices,initialId,initial.label);
    const canFocus=track=>cameraCapabilities(track).focusMode?.some(mode=>mode==="continuous" || mode==="single-shot");
    if(!preferred && canFocus(initial))return stream;
    const candidates=[preferred,...devices.filter(device=>device.kind==="videoinput" && /back|rear|posteriore|environment/i.test(device.label) && !/front|ultra|telephoto|teleob/i.test(device.label))]
      .filter((device,index,items)=>device && device.deviceId!==initialId && items.findIndex(item=>item?.deviceId===device.deviceId)===index).slice(0,3);
    for(const candidate of candidates){
      stop();
      try{if(!await open(candidate.deviceId))return null;if(canFocus(stream.getVideoTracks()[0]))return stream;}
      catch{if(cancelled())return null;}
    }
    if(candidates.length){stop();if(!await open(initialId || ""))return null;}
    return stream;
  } catch(error){stop();throw error;}
}

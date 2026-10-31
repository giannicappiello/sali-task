export function isNormalDecodeMiss(error) {
  return [error?.constructor?.kind, error?.constructor?.name, error?.name].some(name =>
    ["NotFoundException", "ChecksumException", "FormatException"].includes(name));
}

// Keep the original frame intact: a separate canvas handles vertical barcodes.
export function createFrameDecoder(reader, createCanvas = () => document.createElement("canvas")) {
  const frame = createCanvas(), rotated = createCanvas();
  return video => {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight)
      throw new Error("Attendi che l'immagine della fotocamera sia pronta, poi riprova.");
    frame.width = video.videoWidth; frame.height = video.videoHeight;
    const context = frame.getContext("2d", {willReadFrequently:true});
    if (!context) throw new Error("Impossibile acquisire l'immagine della fotocamera.");
    context.drawImage(video, 0, 0, frame.width, frame.height);
    try { return reader.decodeFromCanvas(frame).getText(); }
    catch(error) { if (!isNormalDecodeMiss(error)) throw error; }
    rotated.width = frame.height; rotated.height = frame.width;
    const rotation = rotated.getContext("2d", {willReadFrequently:true});
    if (!rotation) throw new Error("Impossibile elaborare l'immagine. Riprova la fotocamera.");
    rotation.translate(rotated.width, 0); rotation.rotate(Math.PI / 2); rotation.drawImage(frame, 0, 0);
    try { return reader.decodeFromCanvas(rotated).getText(); }
    catch(error) { if (!isNormalDecodeMiss(error)) throw error; }
    return null;
  };
}

export function cameraErrorMessage(error) {
  if (["NotAllowedError", "PermissionDeniedError"].includes(error?.name))
    return "Accesso alla fotocamera negato. Abilitalo nelle impostazioni del browser oppure inserisci barcode o codice IT a mano.";
  if (["NotFoundError", "DevicesNotFoundError"].includes(error?.name)) return "Nessuna fotocamera disponibile. Collega una fotocamera oppure usa il campo manuale.";
  if (["NotReadableError", "TrackStartError"].includes(error?.name)) return "La fotocamera non è disponibile o è utilizzata da un'altra app. Chiudi l'altra app e riprova.";
  return error?.message || "Errore nella lettura. Riprova la fotocamera.";
}

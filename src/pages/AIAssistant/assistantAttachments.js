export const MAX_ASSISTANT_ATTACHMENTS = 4;
export const MAX_ASSISTANT_ATTACHMENT_BYTES = 2_800_000;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Impossibile leggere ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  if (!file.type.startsWith("image/")) return file;
  const source = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();

  let quality = 0.88;
  let blob;
  do {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    quality -= 0.1;
  } while (blob && blob.size > 1_900_000 && quality >= 0.48);
  if (!blob) throw new Error(`Impossibile elaborare ${file.name}.`);
  const name = file.name.replace(/\.[^.]+$/, "") || "foto";
  return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
}

export async function prepareAssistantAttachments(fileList, current = []) {
  const incoming = Array.from(fileList || []);
  if (current.length + incoming.length > MAX_ASSISTANT_ATTACHMENTS) {
    throw new Error(`Puoi allegare al massimo ${MAX_ASSISTANT_ATTACHMENTS} file per richiesta.`);
  }
  const prepared = [];
  for (const original of incoming) {
    if (!ALLOWED_TYPES.has(original.type)) throw new Error(`Formato non supportato: ${original.name}. Usa PDF, JPG, PNG o WebP.`);
    const file = await compressImage(original);
    prepared.push({ id: `${Date.now()}-${crypto.randomUUID()}`, file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : "" });
  }
  const total = [...current, ...prepared].reduce((sum, item) => sum + item.file.size, 0);
  if (total > MAX_ASSISTANT_ATTACHMENT_BYTES) {
    prepared.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
    throw new Error("Gli allegati superano 2,8 MB complessivi. Riduci il PDF o allega meno file.");
  }
  return prepared;
}

export async function serializeAssistantAttachments(items) {
  return Promise.all(items.map(async ({ file }) => ({
    fileName: file.name,
    mediaType: file.type,
    fileBase64: (await readAsDataUrl(file)).split(",")[1] || "",
  })));
}

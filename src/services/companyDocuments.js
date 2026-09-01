import { supabase } from "../lib/supabaseClient.js";

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function base64ToBlob(value, mediaType) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mediaType });
}

async function accessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Sessione Workspace non disponibile.");
  return data.session.access_token;
}

export async function composeWorkspaceDocument(input) {
  const token = await accessToken();
  const response = await fetch("/api/company-documents/compose", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success !== true || !payload.fileBase64) {
    throw Object.assign(new Error(payload.error || `Composizione documento non riuscita (${response.status}).`), { code: payload.code, status: response.status });
  }
  return { ...payload, blob: base64ToBlob(payload.fileBase64, payload.mediaType) };
}

export async function composeWorkspacePdf({ pdf, ...metadata }) {
  const source = pdf instanceof Blob ? await pdf.arrayBuffer() : pdf;
  return composeWorkspaceDocument({ ...metadata, outputFormat: "PDF", contentBase64: arrayBufferToBase64(source) });
}

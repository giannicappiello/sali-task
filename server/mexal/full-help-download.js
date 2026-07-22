// This deliberately returns the Mexal response as received.  The only inspection
// is a fail-closed credential safeguard; it never redacts or otherwise changes it.
const TECHNICAL_CREDENTIAL_KEY = /^(?:authorization|password|passwd|secret|token|api[_-]?key|credential(?:s)?)$/i;

export function findTechnicalCredentialPath(value, path = "$", seen = new WeakSet()) {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    const childPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
    if (TECHNICAL_CREDENTIAL_KEY.test(key)) return childPath;
    const nestedPath = findTechnicalCredentialPath(child, childPath, seen);
    if (nestedPath) return nestedPath;
  }
  return null;
}

export async function downloadFullMexalHelp(client, now = () => new Date().toISOString()) {
  const payload = await client.getJson("/help");
  const credentialPath = findTechnicalCredentialPath(payload);
  if (credentialPath) {
    const error = new Error("Il catalogo Mexal contiene un campo che sembra una credenziale tecnica; download bloccato per sicurezza.");
    error.status = 422;
    error.credentialPath = credentialPath;
    throw error;
  }

  return {
    downloadedAt: now(),
    source: "/webapi/risorse/help",
    payload,
  };
}

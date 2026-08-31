import { proxyPrivateDocuments } from "../server/private-documents.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  try {
    await proxyPrivateDocuments(req, res);
  } catch (error) {
    console.error("Private documents proxy error:", error);
    res.status(error?.status || 500).json({ error: error?.message || "Archivio Documenti Private non disponibile." });
  }
}

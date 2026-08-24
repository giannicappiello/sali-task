import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw Object.assign(new Error(`Variabile Vercel mancante: ${name}`), { status: 500 });
  return value.replace(/\/$/, "");
};

function adminClient() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
}

async function authenticate(req, admin, requiredPermission = null) {
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) throw Object.assign(new Error("Sessione mancante."), { status: 401 });
  const { data: { user }, error } = await admin.auth.getUser(auth.slice(7));
  if (error || !user) throw Object.assign(new Error("Sessione non valida."), { status: 401 });
  const { data: profile } = await admin.from("utenti").select("id,attivo,ruolo_id,ruoli(amministratore_workspace,livello_accesso)").eq("auth_user_id", user.id).maybeSingle();
  if (!profile || profile.attivo === false) throw Object.assign(new Error("Utente non abilitato."), { status: 403 });
  const isAdmin = profile.ruoli?.amministratore_workspace === true || profile.ruoli?.livello_accesso === "amministrazione";
  if (requiredPermission && !isAdmin) {
    const acceptedPermissions = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
    const { data: permissionRows } = await admin.from("permessi_utente").select("permessi!inner(codice)").eq("utente_id", profile.id).in("permessi.codice", acceptedPermissions).limit(1);
    if (!permissionRows?.length) throw Object.assign(new Error("Autorizzazione non concessa per questa operazione."), { status: 403 });
  }
  return { profile, isAdmin };
}

function signedUrl(pathname) {
  const expires = Math.floor(Date.now() / 1000) + 900;
  const signature = createHmac("sha256", required("DOCUMENT_GATEWAY_SECRET")).update(`${pathname}\n${expires}`).digest("hex");
  return `${required("DOCUMENT_GATEWAY_URL")}${pathname}?expires=${expires}&signature=${signature}`;
}

function filePath(path) {
  return `/files/${String(path).split("/").map(encodeURIComponent).join("/")}`;
}

function group(extension) {
  if (extension === ".pdf") return "pdf";
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension)) return "immagine";
  if ([".mp4", ".webm", ".mov", ".m4v"].includes(extension)) return "video";
  return "altro";
}

export function findDocumentSection(sections = [], path = "") {
  const normalizedPath = String(path).replaceAll("\\", "/").toLocaleLowerCase("it");
  return [...sections]
    .sort((a, b) => b.cartella_nas.length - a.cartella_nas.length)
    .find((section) => {
      const folder = String(section.cartella_nas || "").replace(/^\/+|\/+$/g, "").toLocaleLowerCase("it");
      return normalizedPath === folder || normalizedPath.startsWith(`${folder}/`);
    });
}

function nextRome2300(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" }).formatToParts(now).map((part) => [part.type, part.value]));
  const offsetMatch = String(parts.timeZoneName || "GMT+01:00").match(/GMT([+-])(\d{2}):(\d{2})/);
  const offsetMinutes = offsetMatch ? (offsetMatch[1] === "+" ? 1 : -1) * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3])) : 60;
  const addDay = Number(parts.hour || 0) >= 23 ? 1 : 0;
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + addDay, 23, 0) - offsetMinutes * 60000).toISOString();
}

async function stopRequested(admin, runId) {
  if (!runId) return false;
  const { data } = await admin.from("documenti_sync_runs").select("arresto_richiesto").eq("id", runId).maybeSingle();
  return data?.arresto_richiesto === true;
}

async function sync(admin, { runId = null } = {}) {
  const response = await fetch(signedUrl("/manifest"), { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw Object.assign(new Error(`Gateway documentale non disponibile (${response.status}).`), { status: 502 });
  const manifest = await response.json();
  const now = new Date().toISOString();
  const [{ data: catalog, error: catalogError }, { data: sections, error: sectionsError }, { data: products, error: productsError }] = await Promise.all([
    admin.from("documenti_workspace").select("*"),
    admin.from("sezioni_documentali").select("*").eq("attiva", true),
    admin.from("prodotti").select("id,nome,codice,codice_mexal").eq("attivo_mexal", true).eq("mostra_in_app", true),
  ]);
  if (catalogError) throw catalogError;
  if (sectionsError) throw sectionsError;
  if (productsError) throw productsError;
  const byPath = new Map((catalog || []).map((row) => [row.percorso, row]));
  const productCodes = (products || []).map((product) => ({ ...product, code: String(product.codice_mexal || product.codice || "").trim().toUpperCase() })).filter((product) => product.code.startsWith("IT")).sort((a, b) => b.code.length - a.code.length);
  const rows = (manifest.files || []).map((file) => {
    const current = byPath.get(file.path);
    const compactFileName = String(file.name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const matchedProduct = productCodes.find((product) => compactFileName.includes(product.code.replace(/[^A-Z0-9]/g, "")));
    const matchedSection = findDocumentSection(sections || [], file.path);
    return {
      percorso: file.path,
      nome_file: file.name,
      titolo: current?.titolo || file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "),
      estensione: file.extension,
      mime_group: group(file.extension),
      categoria: current?.categoria || file.category || "Altro",
      sezione_id: matchedSection?.id || null,
      marca: current?.marca || null,
      gamma: current?.gamma || null,
      prodotto: current?.prodotto || null,
      prodotto_id: current?.prodotto_id || matchedProduct?.id || null,
      categorie_prodotto: current?.categorie_prodotto || [],
      brand_prodotti: current?.brand_prodotti || [],
      linee_prodotto: current?.linee_prodotto || [],
      parole_chiave: current?.parole_chiave || [],
      dimensione: file.size || 0,
      modificato_il: file.modifiedAt,
      sincronizzato_il: now,
      attivo: true,
      aggiornato_il: current?.aggiornato_il || now,
    };
  });
  if (runId) await admin.from("documenti_sync_runs").update({ stato: "in_esecuzione", file_totali: rows.length, aggiornata_il: now }).eq("id", runId);
  for (let index = 0; index < rows.length; index += 500) {
    if (await stopRequested(admin, runId)) return { count: rows.length, processed: index, removed: 0, stopped: true, generatedAt: manifest.generatedAt };
    const { error } = await admin.from("documenti_workspace").upsert(rows.slice(index, index + 500), { onConflict: "percorso", ignoreDuplicates: false });
    if (error) throw error;
    if (runId) await admin.from("documenti_sync_runs").update({ file_elaborati: Math.min(index + 500, rows.length), aggiornata_il: new Date().toISOString() }).eq("id", runId);
  }
  const paths = rows.map((row) => row.percorso);
  const present = new Set(paths);
  const missingIds = (catalog || []).filter((row) => row.attivo && !present.has(row.percorso)).map((row) => row.id);
  for (let index = 0; index < missingIds.length; index += 500) {
    const { error } = await admin.from("documenti_workspace").update({ attivo: false, sincronizzato_il: now }).in("id", missingIds.slice(index, index + 500));
    if (error) throw error;
  }
  return { count: rows.length, processed: rows.length, removed: missingIds.length, stopped: false, generatedAt: manifest.generatedAt };
}

async function executeSyncRun(admin, origin) {
  const { data: active } = await admin.from("documenti_sync_runs").select("id,stato,iniziata_il").in("stato", ["in_coda","in_esecuzione"]).order("iniziata_il", { ascending: false }).limit(1).maybeSingle();
  if (active) return { alreadyRunning: true, runId: active.id };
  const { data: run, error: runError } = await admin.from("documenti_sync_runs").insert({ origine: origin, stato: "in_coda" }).select().single();
  if (runError) throw runError;
  try {
    const result = await sync(admin, { runId: run.id });
    const completedAt = new Date().toISOString();
    const finalStatus = result.stopped ? "arrestata" : "completata";
    await admin.from("documenti_sync_runs").update({ stato: finalStatus, completata_il: completedAt, file_elaborati: result.processed, file_rimossi: result.removed, dettagli: result, aggiornata_il: completedAt }).eq("id", run.id);
    await admin.from("documenti_sync_config").update({ ultima_esecuzione_il: completedAt, ultimo_stato: finalStatus, ultimo_errore: null, prossima_esecuzione_il: nextRome2300(new Date(Date.now() + 60000)), aggiornato_il: completedAt }).eq("id", 1);
    return { ...result, runId: run.id, status: finalStatus };
  } catch (error) {
    const completedAt = new Date().toISOString();
    await admin.from("documenti_sync_runs").update({ stato: "errore", completata_il: completedAt, errore: error.message, aggiornata_il: completedAt }).eq("id", run.id);
    await admin.from("documenti_sync_config").update({ ultima_esecuzione_il: completedAt, ultimo_stato: "errore", ultimo_errore: error.message, prossima_esecuzione_il: new Date(Date.now() + 60 * 60 * 1000).toISOString(), aggiornato_il: completedAt }).eq("id", 1);
    throw error;
  }
}

export async function runAutomaticDocumentSync(admin) {
  const { data: config, error } = await admin.from("documenti_sync_config").select("*").eq("id", 1).single();
  if (error) throw error;
  if (!config.automatica_attiva) return { status: "disabled" };
  if (config.prossima_esecuzione_il && Date.parse(config.prossima_esecuzione_il) > Date.now()) return { status: "waiting", nextRunAt: config.prossima_esecuzione_il };
  return executeSyncRun(admin, "automatica");
}

export default async function documentApiHandler(req, res) {
  try {
    const admin = adminClient();
    const action = String(req.query?.action || req.body?.action || "list");
    if (req.method === "POST" && (action === "list" || action === "admin_list")) {
      const { isAdmin } = await authenticate(req, admin, action === "admin_list" ? ["integrations.configure", "integrations.sync.documents"] : null);
      let documentsQuery = admin.from("documenti_workspace").select("*").eq("attivo", true).order("titolo");
      if (action === "list") documentsQuery = documentsQuery.not("sezione_id", "is", null);
      const queries = [
        documentsQuery,
        admin.from("sezioni_documentali").select("*").eq("attiva", true).order("ordinamento").order("nome"),
      ];
      if (action === "admin_list") queries.push(admin.from("documenti_sync_config").select("*").eq("id", 1).single(), admin.from("documenti_sync_runs").select("*").order("iniziata_il", { ascending: false }).limit(30));
      const [{ data, error }, { data: sections, error: sectionsError }, configResult, runsResult] = await Promise.all(queries);
      if (error) throw error;
      if (sectionsError) throw sectionsError;
      if (configResult?.error) throw configResult.error;
      if (runsResult?.error) throw runsResult.error;
      return res.status(200).json({ documents: data || [], sections: sections || [], isAdmin, syncConfig: configResult?.data || null, syncRuns: runsResult?.data || [] });
    }
    if (req.method === "POST" && action === "sync") {
      await authenticate(req, admin, "integrations.sync.documents");
      return res.status(200).json(await executeSyncRun(admin, "manuale"));
    }
    if (req.method === "POST" && action === "url") {
      await authenticate(req, admin);
      const id = String(req.body?.id || "");
      const { data, error } = await admin.from("documenti_workspace").select("percorso").eq("id", id).eq("attivo", true).maybeSingle();
      if (error || !data) throw Object.assign(new Error("Documento non trovato."), { status: 404 });
      return res.status(200).json({ url: signedUrl(filePath(data.percorso)), expiresIn: 900 });
    }
    if (req.method === "POST" && action === "update") {
      await authenticate(req, admin, "integrations.configure");
      const id = String(req.body?.id || "");
      const allowed = ["titolo","categoria","marca","gamma","prodotto","prodotto_id","categorie_prodotto","brand_prodotti","linee_prodotto","parole_chiave","sezione_id"];
      const changes = Object.fromEntries(allowed.filter((key) => key in (req.body?.changes || {})).map((key) => [key, req.body.changes[key]]));
      if ("categorie_prodotto" in changes) {
        changes.categorie_prodotto = [...new Set((Array.isArray(changes.categorie_prodotto) ? changes.categorie_prodotto : []).map((value) => String(value || "").trim()).filter(Boolean))];
      }
      for (const field of ["brand_prodotti", "linee_prodotto"]) {
        if (field in changes) changes[field] = [...new Set((Array.isArray(changes[field]) ? changes[field] : []).map((value) => String(value || "").trim()).filter(Boolean))];
      }
      if ("prodotto_id" in changes) {
        changes.prodotto_id = String(changes.prodotto_id || "").trim() || null;
        if (changes.prodotto_id) {
          const { data: product, error: productError } = await admin.from("prodotti").select("id,nome").eq("id", changes.prodotto_id).maybeSingle();
          if (productError) throw productError;
          if (!product) throw Object.assign(new Error("Il prodotto selezionato non esiste o non è più disponibile."), { status: 400 });
          changes.prodotto = product.nome || changes.prodotto || null;
        } else {
          changes.prodotto = null;
        }
      }
      changes.aggiornato_il = new Date().toISOString();
      const { data, error } = await admin.from("documenti_workspace").update(changes).eq("id", id).select().single();
      if (error) throw error;
      return res.status(200).json({ document: data });
    }
    if (req.method === "POST" && action === "urls") {
      await authenticate(req, admin);
      const ids = [...new Set((req.body?.ids || []).map(String).filter(Boolean))].slice(0, 100);
      const { data, error } = await admin.from("documenti_workspace").select("id,percorso").in("id", ids).eq("attivo", true);
      if (error) throw error;
      return res.status(200).json({ urls: Object.fromEntries((data || []).map((item) => [item.id, signedUrl(filePath(item.percorso))])) });
    }
    if (req.method === "POST" && action === "section_save") {
      await authenticate(req, admin, "integrations.configure");
      const section = req.body?.section || {};
      const payload = {
        nome: String(section.nome || "").trim(),
        cartella_nas: String(section.cartella_nas || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "").trim(),
        descrizione: String(section.descrizione || "").trim() || null,
        ordinamento: Number(section.ordinamento || 0), attiva: section.attiva !== false,
        aggiornato_il: new Date().toISOString(),
      };
      if (!payload.nome || !payload.cartella_nas) throw Object.assign(new Error("Nome sezione e cartella NAS sono obbligatori."), { status: 400 });
      const query = section.id ? admin.from("sezioni_documentali").update(payload).eq("id", section.id) : admin.from("sezioni_documentali").insert(payload);
      const { data, error } = await query.select().single();
      if (error) throw error;
      return res.status(200).json({ section: data });
    }
    if (req.method === "POST" && action === "section_delete") {
      await authenticate(req, admin, "integrations.configure");
      const id = String(req.body?.id || "");
      const { error } = await admin.from("sezioni_documentali").delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }
    if (req.method === "POST" && action === "sync_config_save") {
      await authenticate(req, admin, "integrations.configure");
      const enabled = req.body?.enabled === true;
      const now = new Date();
      const { data, error } = await admin.from("documenti_sync_config").update({ automatica_attiva: enabled, prossima_esecuzione_il: enabled ? nextRome2300(now) : null, aggiornato_il: now.toISOString() }).eq("id", 1).select().single();
      if (error) throw error;
      return res.status(200).json({ config: data });
    }
    if (req.method === "POST" && action === "sync_stop") {
      await authenticate(req, admin, "integrations.configure");
      const { data: run, error: findError } = await admin.from("documenti_sync_runs").select("id").in("stato", ["in_coda","in_esecuzione"]).order("iniziata_il", { ascending: false }).limit(1).maybeSingle();
      if (findError) throw findError;
      if (!run) return res.status(200).json({ success: true, stopped: false });
      const { error } = await admin.from("documenti_sync_runs").update({ arresto_richiesto: true, aggiornata_il: new Date().toISOString() }).eq("id", run.id);
      if (error) throw error;
      return res.status(200).json({ success: true, stopped: true, runId: run.id });
    }
    return res.status(405).json({ error: "Metodo non consentito." });
  } catch (error) {
    console.error("documents api", error);
    return res.status(error.status || 500).json({ error: error.message || "Errore archivio documentale." });
  }
}

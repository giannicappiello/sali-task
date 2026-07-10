import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileText, MessageSquare, Paperclip, Save, Search, Trash2, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";

const emptyForm = { titolo: "", descrizione: "", note: "", progetto_id: "", deadline: "", reparto_ids: [], prodotti: [], stato: "da_evadere", bloccante_id: "" };
const closedStates = ["evaso", "evasa", "completato", "completata", "chiuso", "chiusa"];
function safeArray(value) { return Array.isArray(value) ? value : []; }
function normalize(value) { return String(value || "").trim().toLowerCase().replaceAll(" ", "_"); }
function isDone(item) { return closedStates.includes(normalize(item?.stato)) || Boolean(item?.completato_at); }
function dateOnly(value) { return value ? String(value).slice(0, 10) : ""; }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function formatFileSize(bytes) { const value = Number(bytes || 0); if (!value) return ""; if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / (1024 * 1024)).toFixed(1)} MB`; }

export default function PhaseChecklistModal({
  open,
  phase = null,
  initialDate = "",
  projects = [],
  departments = [],
  products = [],
  phaseDepartments = [],
  phaseProducts = [],
  templates = [],
  templateDepartments = [],
  allPhases = [],
  initialProjectId = "",
  initialProductIds = [],
  canManage = true,
  canCompleteDepartment = () => true,
  onClose,
  onSaved,
}) {
  const { profile } = useAuth();
  const actorId = profile?.id || null;
  const [form, setForm] = useState(emptyForm);
  const [comments, setComments] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [comment, setComment] = useState("");
  const [pendingComments, setPendingComments] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [showPhaseProducts, setShowPhaseProducts] = useState(false);
  const [phaseProductQuery, setPhaseProductQuery] = useState("");

  const selectedPhase = phase?.id ? phase : null;

  useEffect(() => {
    if (!open) return;
    setPendingComments([]);
    setPendingFiles([]);
    setComment("");
    setShowPhaseProducts(false);
    setPhaseProductQuery("");
    if (selectedPhase?.id) {
      setForm({
        titolo: selectedPhase.titolo || "",
        descrizione: selectedPhase.descrizione || "",
        note: selectedPhase.note || "",
        progetto_id: selectedPhase.progetto_id || "",
        deadline: dateOnly(selectedPhase.deadline) || "",
        reparto_ids: getPhaseDepartmentIds(selectedPhase.id).length ? getPhaseDepartmentIds(selectedPhase.id) : [selectedPhase.reparto_id].filter(Boolean),
        prodotti: getPhaseProductIds(selectedPhase.id),
        stato: selectedPhase.stato || "da_evadere",
        bloccante_id: selectedPhase.bloccante_id || "",
      });
      loadPhaseDetails(selectedPhase.id);
    } else {
      setForm({
        ...emptyForm,
        progetto_id: initialProjectId || "",
        deadline: initialDate || todayIso(),
        prodotti: [...new Set(safeArray(initialProductIds).filter(Boolean))],
      });
      setComments([]);
      setAttachments([]);
    }
  }, [open, selectedPhase?.id, initialDate, initialProjectId, safeArray(initialProductIds).join(",")]);

  function getPhaseDepartmentIds(phaseId) {
    return safeArray(phaseDepartments).filter((row) => row.fase_id === phaseId && row.reparto_id).map((row) => row.reparto_id);
  }

  function getPhaseProductIds(phaseId) {
    return safeArray(phaseProducts).filter((row) => row.fase_id === phaseId && row.prodotto_id).map((row) => row.prodotto_id);
  }

  function getTemplateDepartmentIds(templateId) {
    return safeArray(templateDepartments).filter((row) => row.template_id === templateId && row.reparto_id).map((row) => row.reparto_id);
  }

  const blockingOptions = useMemo(() => safeArray(allPhases).filter((item) => item.id && item.id !== selectedPhase?.id), [allPhases, selectedPhase?.id]);

  const selectedBlocker = useMemo(() => blockingOptions.find((item) => item.id === form.bloccante_id) || null, [blockingOptions, form.bloccante_id]);

  const filteredPhaseProducts = useMemo(() => {
    const text = phaseProductQuery.trim().toLowerCase();
    if (!text) return products;
    return products.filter((product) => `${product.nome || ""} ${product.codice || ""} ${product.brand || ""} ${product.categoria || ""}`.toLowerCase().includes(text));
  }, [products, phaseProductQuery]);

  const departmentsByPhase = useMemo(() => {
    const map = new Map();
    safeArray(phaseDepartments).forEach((row) => {
      const department = departments.find((item) => item.id === row.reparto_id) || row.reparti;
      const list = map.get(row.fase_id) || [];
      if (department) list.push({ ...department, fase_reparto_id: row.id, completato: Boolean(row.completato), completato_at: row.completato_at, completato_da: row.completato_da });
      map.set(row.fase_id, list);
    });
    return map;
  }, [phaseDepartments, departments]);

  async function getCurrentUtenteId() {
    if (profile?.id) {
      const byId = await supabase.from("utenti").select("id").eq("id", profile.id).maybeSingle();
      if (byId.data?.id) return byId.data.id;
    }
    if (profile?.auth_user_id) {
      const byProfileAuth = await supabase.from("utenti").select("id").eq("auth_user_id", profile.auth_user_id).maybeSingle();
      if (byProfileAuth.data?.id) return byProfileAuth.data.id;
    }
    const { data: authData } = await supabase.auth.getUser();
    const authUserId = authData?.user?.id;
    if (!authUserId) return null;
    const byAuth = await supabase.from("utenti").select("id").eq("auth_user_id", authUserId).maybeSingle();
    return byAuth.data?.id || null;
  }

  async function loadPhaseDetails(phaseId) {
    const [commentsRes, attachmentsRes] = await Promise.all([
      supabase.from("v4_commenti").select("id,testo,created_at,creato_da").eq("entity_type", "fase_progetto").eq("entity_id", phaseId).order("created_at", { ascending: true }),
      supabase.from("v4_allegati").select("*").eq("entity_type", "fase_progetto").eq("entity_id", phaseId).order("created_at", { ascending: false }),
    ]);
    setComments(commentsRes.data || []);
    setAttachments(attachmentsRes.data || []);
  }

  function applyTemplate(templateId) {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    const ids = getTemplateDepartmentIds(template.id);
    const effectiveIds = ids.length ? ids : [template.reparto_id].filter(Boolean);
    setForm((current) => ({ ...current, titolo: template.titolo || "", reparto_ids: effectiveIds }));
  }

  function togglePhaseDepartment(departmentId) {
    setForm((current) => {
      const currentIds = safeArray(current.reparto_ids);
      const nextIds = currentIds.includes(departmentId) ? currentIds.filter((id) => id !== departmentId) : [...currentIds, departmentId];
      return { ...current, reparto_ids: nextIds };
    });
  }

  function togglePhaseProduct(productId) {
    setForm((current) => {
      const currentIds = safeArray(current.prodotti);
      const nextIds = currentIds.includes(productId) ? currentIds.filter((id) => id !== productId) : [...currentIds, productId];
      return { ...current, prodotti: nextIds };
    });
  }

  async function savePhaseDepartments(phaseId, departmentIds) {
    const uniqueIds = [...new Set(safeArray(departmentIds).filter(Boolean))];
    const { data: existingRows, error: existingError } = await supabase.from("v4_fase_reparti").select("id,fase_id,reparto_id,completato,completato_at,completato_da").eq("fase_id", phaseId);
    if (existingError) throw existingError;
    const existing = existingRows || [];
    const existingIds = existing.map((row) => row.reparto_id).filter(Boolean);
    const idsToDelete = existingIds.filter((id) => !uniqueIds.includes(id));
    const idsToInsert = uniqueIds.filter((id) => !existingIds.includes(id));
    if (idsToDelete.length) {
      const { error } = await supabase.from("v4_fase_reparti").delete().eq("fase_id", phaseId).in("reparto_id", idsToDelete);
      if (error) throw error;
    }
    if (idsToInsert.length) {
      const { error } = await supabase.from("v4_fase_reparti").insert(idsToInsert.map((reparto_id) => ({ fase_id: phaseId, reparto_id, completato: false })));
      if (error) throw error;
    }
    if (!uniqueIds.length) {
      const { error } = await supabase.from("v4_fase_reparti").delete().eq("fase_id", phaseId);
      if (error) throw error;
    }
  }

  async function savePhaseProducts(phaseId, productIds) {
    await supabase.from("v4_fase_prodotti").delete().eq("fase_id", phaseId);
    const rows = safeArray(productIds).map((prodotto_id) => {
      const product = products.find((item) => item.id === prodotto_id);
      return { fase_id: phaseId, prodotto_id, prodotto_nome: product?.nome || null };
    });
    if (rows.length) {
      const { error } = await supabase.from("v4_fase_prodotti").insert(rows);
      if (error) throw error;
    }
  }

  async function log(entity_type, entity_id, azione, dettagli) {
    await supabase.from("v4_audit_log").insert({ entity_type, entity_id, azione, dettagli: { testo: dettagli || "" }, user_id: actorId });
  }

  async function insertComment(phaseId, text) {
    const { data: authData } = await supabase.auth.getUser();
    const authUserId = authData?.user?.id || actorId;
    const { error } = await supabase.from("v4_commenti").insert({ entity_type: "fase_progetto", entity_id: phaseId, testo: text, creato_da: authUserId });
    if (error) throw error;
  }

  async function uploadAttachmentForPhase(phaseId, file) {
    const currentUtenteId = await getCurrentUtenteId();
    if (!currentUtenteId) throw new Error("Utente non trovato nella tabella utenti. Verifica login e tabella utenti.");
    const cleanFileName = file.name.replaceAll("/", "-");
    const path = `${currentUtenteId}/fasi/${phaseId}/${Date.now()}-${cleanFileName}`;
    const uploaded = await supabase.storage.from("allegati").upload(path, file, { upsert: true });
    if (uploaded.error) throw uploaded.error;
    const { error } = await supabase.from("v4_allegati").insert({ entity_type: "fase_progetto", entity_id: phaseId, file_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size || null, caricato_da: currentUtenteId });
    if (error) throw error;
  }

  async function savePhase(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi per modificare le fasi.");
    if (!form.titolo.trim()) return alert("Seleziona il titolo della fase dalla checklist.");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload = {
        progetto_id: form.progetto_id || null,
        titolo: form.titolo.trim(),
        descrizione: form.descrizione.trim() || null,
        note: form.note.trim() || null,
        priorita: null,
        deadline: form.deadline || null,
        reparto_id: safeArray(form.reparto_ids)[0] || null,
        assegnato_a: null,
        stato: form.stato || "da_evadere",
        bloccante_id: form.bloccante_id || null,
        modificato_da: actorId,
        updated_at: now,
      };
      if (!selectedPhase?.id) payload.creato_da = actorId;
      const request = selectedPhase?.id
        ? supabase.from("v4_fasi_progetto").update(payload).eq("id", selectedPhase.id).select().single()
        : supabase.from("v4_fasi_progetto").insert(payload).select().single();
      const { data, error } = await request;
      if (error) throw error;
      const phaseId = data?.id || selectedPhase?.id;
      await savePhaseDepartments(phaseId, form.reparto_ids);
      await savePhaseProducts(phaseId, form.prodotti);
      for (const text of pendingComments) await insertComment(phaseId, text);
      for (const file of pendingFiles) await uploadAttachmentForPhase(phaseId, file);
      await log("fase_progetto", phaseId, selectedPhase?.id ? "modifica fase" : "nuova fase", payload.titolo);
      setSaving(false);
      onSaved?.();
      onClose?.();
    } catch (error) {
      console.error(error);
      setSaving(false);
      alert(error.message || "Errore salvataggio fase.");
    }
  }

  async function saveComment(e) {
    e.preventDefault();
    const text = comment.trim();
    if (!text) return;
    if (!selectedPhase?.id) {
      setPendingComments((current) => [...current, text]);
      setComment("");
      return;
    }
    try {
      await insertComment(selectedPhase.id, text);
      setComment("");
      await loadPhaseDetails(selectedPhase.id);
    } catch (error) {
      alert(error.message);
    }
  }

  async function uploadFiles(files) {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    if (!selectedPhase?.id) {
      setPendingFiles((current) => [...current, ...list]);
      return;
    }
    try {
      for (const file of list) await uploadAttachmentForPhase(selectedPhase.id, file);
      await loadPhaseDetails(selectedPhase.id);
    } catch (error) {
      alert(`Errore upload. Verifica bucket "allegati". ${error.message}`);
    }
  }

  function handleAttachmentDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    if (e.type === "dragleave") setDragActive(false);
  }

  async function handleAttachmentDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    await uploadFiles(e.dataTransfer?.files);
  }

  function attachmentUrl(attachment) {
    if (!attachment?.file_path) return "#";
    const { data } = supabase.storage.from("allegati").getPublicUrl(attachment.file_path);
    return data?.publicUrl || "#";
  }

  function isImageAttachment(attachment) {
    const mime = String(attachment?.mime_type || "").toLowerCase();
    const name = String(attachment?.file_name || "").toLowerCase();
    return mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
  }

  async function removeAttachment(attachment) {
    if (!canManage) return alert("Non hai i permessi per eliminare gli allegati.");
    if (!attachment?.id || !selectedPhase?.id) return;
    if (!window.confirm(`Vuoi eliminare l'allegato "${attachment.file_name || "file"}"?`)) return;
    if (attachment.file_path) {
      const storageDelete = await supabase.storage.from("allegati").remove([attachment.file_path]);
      if (storageDelete.error) return alert(`Errore eliminazione file: ${storageDelete.error.message}`);
    }
    const { error } = await supabase.from("v4_allegati").delete().eq("id", attachment.id);
    if (error) return alert(error.message);
    await loadPhaseDetails(selectedPhase.id);
  }

  async function deletePhase() {
    if (!canManage) return alert("Non hai i permessi per eliminare le fasi.");
    if (!selectedPhase?.id) return;
    if (!window.confirm("Eliminare questa task/fase?\n\nVerranno eliminati anche commenti, reparti, prodotti, allegati, storico e file fisici collegati.")) return;

    setSaving(true);

    const { data: files, error: filesError } = await supabase
      .from("v4_allegati")
      .select("file_path")
      .eq("entity_type", "fase_progetto")
      .eq("entity_id", selectedPhase.id);

    if (filesError) {
      setSaving(false);
      return alert(filesError.message);
    }

    const paths = (files || []).map((file) => file.file_path).filter(Boolean);

    if (paths.length) {
      const { error: storageError } = await supabase.storage
        .from("allegati")
        .remove(paths);

      if (storageError) {
        setSaving(false);
        return alert(`Errore eliminazione file: ${storageError.message}`);
      }
    }

    await supabase.from("v4_commenti").delete().eq("entity_type", "fase_progetto").eq("entity_id", selectedPhase.id);
    await supabase.from("v4_allegati").delete().eq("entity_type", "fase_progetto").eq("entity_id", selectedPhase.id);
    await supabase.from("v4_fase_reparti").delete().eq("fase_id", selectedPhase.id);
    await supabase.from("v4_fase_prodotti").delete().eq("fase_id", selectedPhase.id);
    await supabase.from("v4_audit_log").delete().eq("entity_type", "fase_progetto").eq("entity_id", selectedPhase.id);

    const { error } = await supabase.from("v4_fasi_progetto").delete().eq("id", selectedPhase.id);

    setSaving(false);

    if (error) return alert(error.message);

    onSaved?.();
    onClose?.();
  }

  async function completeDepartmentPhase(department) {
    if (!selectedPhase?.id || !department?.id) return;
    if (!canCompleteDepartment(department.id)) return alert("Non hai i permessi per completare questo reparto.");
    const now = new Date().toISOString();
    const { error } = await supabase.from("v4_fase_reparti").update({ completato: true, completato_at: now, completato_da: actorId }).eq("fase_id", selectedPhase.id).eq("reparto_id", department.id);
    if (error) return alert(error.message);
    const { data: rows, error: rowsError } = await supabase.from("v4_fase_reparti").select("reparto_id,completato").eq("fase_id", selectedPhase.id);
    if (rowsError) return alert(rowsError.message);
    const allCompleted = (rows || []).length > 0 && (rows || []).every((row) => Boolean(row.completato));
    const payload = allCompleted ? { stato: "evaso", completato_da: actorId, completato_at: now, modificato_da: actorId, updated_at: now } : { stato: "in_lavorazione", completato_da: null, completato_at: null, modificato_da: actorId, updated_at: now };
    const { error: phaseError } = await supabase.from("v4_fasi_progetto").update(payload).eq("id", selectedPhase.id);
    if (phaseError) return alert(phaseError.message);
    await log("fase_progetto", selectedPhase.id, allCompleted ? "fase evasa da tutti i reparti" : "reparto completato", `${selectedPhase.titolo || "Fase"} · ${department.nome}`);
    onSaved?.();
  }

  async function reopenDepartmentPhase(department) {
    if (!selectedPhase?.id || !department?.id) return;
    const now = new Date().toISOString();
    const { error } = await supabase.from("v4_fase_reparti").update({ completato: false, completato_at: null, completato_da: null }).eq("fase_id", selectedPhase.id).eq("reparto_id", department.id);
    if (error) return alert(error.message);
    const { error: phaseError } = await supabase.from("v4_fasi_progetto").update({ stato: "in_lavorazione", completato_da: null, completato_at: null, modificato_da: actorId, updated_at: now }).eq("id", selectedPhase.id);
    if (phaseError) return alert(phaseError.message);
    await log("fase_progetto", selectedPhase.id, "reparto riaperto", `${selectedPhase.titolo || "Fase"} · ${department.nome}`);
    onSaved?.();
  }

  if (!open) return null;
  const availableDepartments = departments;
  const completedDepartments = selectedPhase?.id ? (departmentsByPhase.get(selectedPhase.id) || []) : [];
  const selectedTemplateValue = templates.find((item) => item.titolo === form.titolo)?.id || "";

  return (
    <div className="modal-backdrop">
      <form className="modal-card v4-modal large-modal" onSubmit={savePhase}>
        <div className="modal-header">
          <h2>{selectedPhase ? "Modifica task / fase" : "Nuova fase checklist"}</h2>
          <button type="button" onClick={onClose}><X size={20} /></button>
        </div>

        <label>Checklist
          <select value={selectedTemplateValue} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">Seleziona checklist...</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.titolo}{template.reparti?.nome ? ` · ${template.reparti.nome}` : ""}</option>
            ))}
          </select>
        </label>
        <label>Descrizione<textarea rows="3" value={form.descrizione} onChange={(e) => setForm({ ...form, descrizione: e.target.value })} /></label>
        <label>Note<textarea rows="3" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>

        <div className="form-grid-2">
          <label>Stato<select value={form.stato} onChange={(e) => setForm({ ...form, stato: e.target.value })}><option value="da_evadere">Da evadere</option><option value="in_lavorazione">In lavorazione</option><option value="in_valutazione">In valutazione</option><option value="evaso">Evaso</option></select></label>
          <label>Reparti selezionati<input disabled value={safeArray(form.reparto_ids).map((id) => departments.find((d) => d.id === id)?.nome).filter(Boolean).join(", ") || "Nessun reparto"} /></label>
        </div>

        <label>Fase / task bloccante
          <select value={form.bloccante_id} onChange={(e) => setForm({ ...form, bloccante_id: e.target.value })}>
            <option value="">Nessuna fase bloccante</option>
            {blockingOptions.map((item) => (
              <option key={item.id} value={item.id}>{item.titolo || "Fase senza titolo"}{item.v4_progetti?.titolo ? ` · ${item.v4_progetti.titolo}` : ""}</option>
            ))}
          </select>
        </label>
        {selectedBlocker && !isDone(selectedBlocker) && <p className="soft-alert">Fase bloccata fino al completamento di: {selectedBlocker.titolo || "fase bloccante"}</p>}

        <div className="checkbox-group scrollable-check-group">
          <strong>Reparti competenti sulla fase</strong>
          {availableDepartments.map((d) => (
            <label key={d.id}><input type="checkbox" checked={safeArray(form.reparto_ids).includes(d.id)} onChange={() => togglePhaseDepartment(d.id)} />{d.nome}</label>
          ))}
        </div>

        {selectedPhase?.id && completedDepartments.length > 0 && (
          <div className="checkbox-group">
            <strong>Completamento per reparto</strong>
            {completedDepartments.map((department) => (
              <div key={department.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", padding: "8px 0" }}>
                <span>{department.completato ? "✓" : "○"} {department.nome}{department.completato_at ? ` · ${new Date(department.completato_at).toLocaleString("it-IT")}` : ""}</span>
                {department.completato ? (
                  <button type="button" className="reopen-phase-btn" onClick={() => reopenDepartmentPhase(department)}><Clock3 size={15} /> Riapri {department.nome}</button>
                ) : (
                  <button type="button" className="complete-phase-btn" onClick={() => completeDepartmentPhase(department)} disabled={!canCompleteDepartment(department.id)}><CheckCircle2 size={15} /> Completa {department.nome}</button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="phase-products-toolbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
          <strong>Prodotti associati alla fase: {safeArray(form.prodotti).length}</strong>
          <button type="button" className="filter-chip" onClick={() => setShowPhaseProducts((value) => !value)}>{showPhaseProducts ? "Chiudi prodotti" : safeArray(form.prodotti).length ? "Aggiungi/Modifica/Rimuovi prodotti" : "Aggiungi prodotti"}</button>
        </div>

        {showPhaseProducts && (
          <div className="checkbox-group scrollable-check-group">
            <strong>Prodotti associati alla fase</strong>
            <div className="task-search" style={{ margin: "8px 0" }}>
              <Search size={18} />
              <input placeholder="Ricerca rapida prodotto..." value={phaseProductQuery} onChange={(e) => setPhaseProductQuery(e.target.value)} />
            </div>
            {filteredPhaseProducts.length === 0 ? (
              <p className="empty-text">Nessun prodotto trovato.</p>
            ) : (
              filteredPhaseProducts.map((p) => <label key={p.id}><input type="checkbox" checked={safeArray(form.prodotti).includes(p.id)} onChange={() => togglePhaseProduct(p.id)} />{p.nome}{p.codice ? ` · ${p.codice}` : ""}</label>)
            )}
          </div>
        )}

        <label>Progetto<select value={form.progetto_id} onChange={(e) => setForm({ ...form, progetto_id: e.target.value })}><option value="">Senza progetto</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.titolo}</option>)}</select></label>
        <label>Deadline<input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></label>

        <div className="phase-detail-extra">
          <div className="phase-extra-title"><MessageSquare size={18} /><strong>Commenti</strong></div>
          <div className="comments-box">
            {comments.length === 0 && pendingComments.length === 0 ? <p className="muted">Nessun commento.</p> : null}
            {comments.map((c) => <p key={c.id}><strong>{c.creato_da === actorId ? "Tu" : "Utente"}</strong> {c.testo}<small>{new Date(c.created_at).toLocaleString("it-IT")}</small></p>)}
            {pendingComments.map((text, index) => <p key={`pending-comment-${index}`}><strong>Da salvare</strong> {text}</p>)}
          </div>
          <div className="comment-form-inline">
            <input placeholder="Aggiungi commento..." value={comment} onChange={(e) => setComment(e.target.value)} />
            <button type="button" onClick={saveComment}><MessageSquare size={16} /> Invia</button>
          </div>

          <div className="phase-extra-title"><FileText size={18} /><strong>Allegati</strong></div>
          <label className={`upload-box ${dragActive ? "drag-active" : ""}`} onDragEnter={handleAttachmentDrag} onDragOver={handleAttachmentDrag} onDragLeave={handleAttachmentDrag} onDrop={handleAttachmentDrop} style={{ border: dragActive ? "2px dashed #0b63ce" : undefined, background: dragActive ? "rgba(11, 99, 206, 0.08)" : undefined, cursor: "pointer" }}>
            <Paperclip size={18} />{dragActive ? "Rilascia qui gli allegati" : "Carica allegato o trascina qui i file"}
            <input type="file" multiple hidden onChange={async (e) => { await uploadFiles(e.target.files); e.target.value = ""; }} />
          </label>

          <div className="attachments-list">
            {attachments.length === 0 && pendingFiles.length === 0 ? <span>Nessun allegato.</span> : null}
            {pendingFiles.map((file, index) => <div key={`pending-file-${index}`} className="attachment-row"><strong>{file.name}</strong><small className="muted">Da caricare al salvataggio · {formatFileSize(file.size)}</small></div>)}
            {attachments.map((a) => {
              const url = attachmentUrl(a);
              const image = isImageAttachment(a);
              return (
                <div key={a.id} className="attachment-row" style={{ display: "grid", gridTemplateColumns: image ? "72px 1fr auto" : "1fr auto", gap: "12px", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #eee" }}>
                  {image && <a href={url} target="_blank" rel="noopener noreferrer" title="Apri anteprima"><img src={url} alt={a.file_name || "Allegato"} style={{ width: "64px", height: "64px", objectFit: "cover", borderRadius: "8px", border: "1px solid #ddd" }} /></a>}
                  <div style={{ minWidth: 0 }}><strong style={{ display: "block", wordBreak: "break-word" }}>{a.file_name || "Allegato"}</strong><small className="muted">{formatFileSize(a.size_bytes)}</small></div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <a href={url} target="_blank" rel="noopener noreferrer" download={a.file_name || true} className="primary-action" style={{ padding: "7px 12px", textDecoration: "none", fontSize: "13px" }}>Scarica</a>
                    {canManage && <button type="button" className="phase-icon-btn danger" onClick={() => removeAttachment(a)} title="Elimina allegato"><Trash2 size={15} /></button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="dashboard-message-actions">
          {selectedPhase?.id && canManage && (
            <button type="button" className="secondary-action danger" onClick={deletePhase} disabled={saving}>
              <Trash2 size={18} /> Elimina
            </button>
          )}
          <button className="primary-action" disabled={saving}><Save size={18} /> {saving ? "Salvataggio..." : "Salva fase"}</button>
        </div>
      </form>
    </div>
  );
}

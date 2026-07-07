import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Edit3,
  FileText,
  MessageSquare,
  Paperclip,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

const projectEmpty = {
  titolo: "",
  descrizione: "",
  priorita: "Media",
  deadline: "",
  prodotti: [],
  reparti: [],
};

const phaseEmpty = {
  titolo: "",
  descrizione: "",
  note: "",
  deadline: "",
  reparto_id: "",
  stato: "da_evadere",
};

const closedStates = ["evaso", "evasa", "completato", "completata", "chiuso", "chiusa"];

function normalize(value) {
  return String(value || "").trim().toLowerCase().replaceAll(" ", "_");
}

function isDone(item) {
  return closedStates.includes(normalize(item?.stato)) || Boolean(item?.completato_at);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function statusClass(item) {
  if (isDone(item)) return "done";
  if (item.deadline && item.deadline < todayIso()) return "danger";
  if (item.deadline === todayIso()) return "today";
  return "open";
}

function formatDate(date) {
  return date ? new Date(`${date}T00:00:00`).toLocaleDateString("it-IT") : "-";
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export default function Projects() {
  const { profile, hasPermission } = useAuth();
  const canManage = hasPermission("projects.write");
  const actorId = profile?.id || null;

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

  const [projects, setProjects] = useState([]);
  const [phases, setPhases] = useState([]);
  const [products, setProducts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [projectProducts, setProjectProducts] = useState([]);
  const [projectDepartments, setProjectDepartments] = useState([]);
  const [phaseProducts, setPhaseProducts] = useState([]);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("tutti");
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedPhase, setSelectedPhase] = useState(null);
  const [projectModal, setProjectModal] = useState(false);
  const [phaseModal, setPhaseModal] = useState(false);
  const [projectForm, setProjectForm] = useState(projectEmpty);
  const [phaseForm, setPhaseForm] = useState(phaseEmpty);
  const [comments, setComments] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedPhase?.id) loadPhaseDetails(selectedPhase.id);
    else {
      setComments([]);
      setAttachments([]);
    }
  }, [selectedPhase?.id]);

  async function loadData() {
    setLoading(true);
    const [projectsRes, phasesRes, productsRes, departmentsRes, usersRes, templatesRes, ppRes, prRes, fpRes] = await Promise.all([
      supabase.from("v4_progetti").select("*").order("created_at", { ascending: false }),
      supabase
        .from("v4_fasi_progetto")
        .select("*,v4_progetti(titolo),reparti(id,nome)")
        .order("ordine", { ascending: true })
        .order("deadline", { ascending: true, nullsFirst: false }),
      supabase.from("prodotti").select("id,nome,codice").order("nome").limit(5000),
      supabase.from("reparti").select("id,nome,attivo").order("nome"),
      supabase.from("utenti").select("id,nome,email,reparto_id,attivo").order("nome"),
      supabase.from("checklist_template").select("id,titolo,reparto_id,ordine,attivo,reparti(id,nome)").order("ordine", { ascending: true }),
      supabase.from("v4_progetto_prodotti").select("id,progetto_id,prodotto_id,prodotto_nome"),
      supabase.from("v4_progetto_reparti").select("id,progetto_id,reparto_id"),
      supabase.from("v4_fase_prodotti").select("id,fase_id,prodotto_id,prodotto_nome"),
    ]);

    if (projectsRes.error) console.error("Progetti:", projectsRes.error.message);
    if (phasesRes.error) console.error("Fasi:", phasesRes.error.message);

    setProjects(projectsRes.data || []);
    setPhases(phasesRes.data || []);
    setProducts((productsRes.data || []).filter((item) => item.id));
    setDepartments((departmentsRes.data || []).filter((item) => item.attivo !== false));
    setUsers((usersRes.data || []).filter((item) => item.attivo !== false));
    setTemplates((templatesRes.data || []).filter((item) => item.attivo !== false));
    setProjectProducts(ppRes.data || []);
    setProjectDepartments(prRes.data || []);
    setPhaseProducts(fpRes.data || []);
    setLoading(false);
  }

  async function loadPhaseDetails(phaseId) {
    const [commentsRes, attachmentsRes] = await Promise.all([
      supabase
        .from("v4_commenti")
        .select("id,testo,created_at,creato_da")
        .eq("entity_type", "fase_progetto")
        .eq("entity_id", phaseId)
        .order("created_at", { ascending: true }),
      supabase
        .from("v4_allegati")
        .select("*")
        .eq("entity_type", "fase_progetto")
        .eq("entity_id", phaseId)
        .order("created_at", { ascending: false }),
    ]);

    setComments(commentsRes.data || []);
    setAttachments(attachmentsRes.data || []);
  }

  const phasesByProject = useMemo(() => {
    const map = new Map();
    phases.forEach((phase) => {
      const list = map.get(phase.progetto_id) || [];
      list.push(phase);
      map.set(phase.progetto_id, list);
    });
    return map;
  }, [phases]);

  const productsByProject = useMemo(() => {
    const map = new Map();
    projectProducts.forEach((row) => {
      const list = map.get(row.progetto_id) || [];
      const product = products.find((item) => item.id === row.prodotto_id);
      list.push(product?.nome || row.prodotto_nome || "Prodotto");
      map.set(row.progetto_id, list);
    });
    return map;
  }, [projectProducts, products]);

  const productsByPhase = useMemo(() => {
    const map = new Map();
    phaseProducts.forEach((row) => {
      const list = map.get(row.fase_id) || [];
      const product = products.find((item) => item.id === row.prodotto_id);
      list.push({
        id: row.prodotto_id,
        nome: product?.nome || row.prodotto_nome || "Prodotto",
        codice: product?.codice || "",
      });
      map.set(row.fase_id, list);
    });
    return map;
  }, [phaseProducts, products]);

  const departmentsByProject = useMemo(() => {
    const map = new Map();
    projectDepartments.forEach((row) => {
      const list = map.get(row.progetto_id) || [];
      const department = departments.find((item) => item.id === row.reparto_id);
      if (department?.nome) list.push(department.nome);
      map.set(row.progetto_id, list);
    });
    return map;
  }, [projectDepartments, departments]);

  const filteredProjects = useMemo(() => {
    const text = query.trim().toLowerCase();
    return projects.filter((project) => {
      const projectPhases = phasesByProject.get(project.id) || [];
      const hasOpen = projectPhases.some((phase) => !isDone(phase));
      const hasOverdue = projectPhases.some((phase) => statusClass(phase) === "danger");
      const hasToday = projectPhases.some((phase) => statusClass(phase) === "today");
      const allDone = projectPhases.length > 0 && projectPhases.every(isDone);

      if (statusFilter === "aperti" && !hasOpen) return false;
      if (statusFilter === "oggi" && !hasToday) return false;
      if (statusFilter === "scaduti" && !hasOverdue) return false;
      if (statusFilter === "completati" && !allDone) return false;

      if (!text) return true;
      const productNames = (productsByProject.get(project.id) || []).join(" ");
      const departmentNames = (departmentsByProject.get(project.id) || []).join(" ");
      const phaseText = projectPhases
        .map((phase) => {
          const phaseProductNames = (productsByPhase.get(phase.id) || []).map((item) => item.nome).join(" ");
          return `${phase.titolo} ${phase.descrizione} ${phaseProductNames}`;
        })
        .join(" ");
      return `${project.titolo || ""} ${project.descrizione || ""} ${productNames} ${departmentNames} ${phaseText}`
        .toLowerCase()
        .includes(text);
    });
  }, [projects, phasesByProject, productsByProject, departmentsByProject, productsByPhase, query, statusFilter]);

  function getProjectProductIds(projectId) {
    return projectProducts.filter((row) => row.progetto_id === projectId && row.prodotto_id).map((row) => row.prodotto_id);
  }

  function getProjectDepartmentIds(projectId) {
    return projectDepartments.filter((row) => row.progetto_id === projectId && row.reparto_id).map((row) => row.reparto_id);
  }

  function getPhaseProductIds(phaseId) {
    return phaseProducts.filter((row) => row.fase_id === phaseId && row.prodotto_id).map((row) => row.prodotto_id);
  }

  function openProject(project = null) {
    setSelectedProject(project);
    setProjectForm(
      project
        ? {
            titolo: project.titolo || "",
            descrizione: project.descrizione || "",
            priorita: project.priorita || "Media",
            deadline: project.deadline || "",
            prodotti: getProjectProductIds(project.id),
            reparti: getProjectDepartmentIds(project.id),
          }
        : { ...projectEmpty }
    );
    setProjectModal(true);
  }

  function openPhase(project, phase = null) {
    setSelectedProject(project);
    setSelectedPhase(phase);
    setPhaseForm(
      phase
        ? {
            titolo: phase.titolo || "",
            descrizione: phase.descrizione || "",
            note: phase.note || "",
            deadline: phase.deadline || "",
            reparto_id: phase.reparto_id || "",
            stato: phase.stato || "da_evadere",
            prodotti: getPhaseProductIds(phase.id),
          }
        : { ...phaseEmpty }
    );
    setPhaseModal(true);
  }

  function toggleMulti(value, field) {
    setProjectForm((current) => ({
      ...current,
      [field]: current[field].includes(value) ? current[field].filter((id) => id !== value) : [...current[field], value],
    }));
  }

  function togglePhaseProduct(productId) {
    setPhaseForm((current) => ({
      ...current,
      prodotti: safeArray(current.prodotti).includes(productId)
        ? safeArray(current.prodotti).filter((id) => id !== productId)
        : [...safeArray(current.prodotti), productId],
    }));
  }

  async function saveProject(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi per modificare i progetti.");
    if (!projectForm.titolo.trim()) return alert("Inserisci il titolo del progetto.");

    setSaving(true);
    const payload = {
      titolo: projectForm.titolo.trim(),
      descrizione: projectForm.descrizione.trim() || null,
      priorita: projectForm.priorita || "Media",
      deadline: projectForm.deadline || null,
      modificato_da: actorId,
      updated_at: new Date().toISOString(),
    };

    if (!selectedProject?.id) payload.creato_da = actorId;

    const request = selectedProject?.id
      ? supabase.from("v4_progetti").update(payload).eq("id", selectedProject.id).select().single()
      : supabase.from("v4_progetti").insert(payload).select().single();

    const { data, error } = await request;
    if (error) {
      setSaving(false);
      return alert(error.message);
    }

    const projectId = data.id;
    await saveAssociations(projectId, projectForm.prodotti, projectForm.reparti);

    if (!selectedProject?.id) {
      await createTemplatePhases(projectId, projectForm.reparti);
    }

    await log("progetto", projectId, selectedProject?.id ? "modifica progetto" : "creazione progetto", payload.titolo);
    setSaving(false);
    setProjectModal(false);
    await loadData();
  }

  async function createTemplatePhases(projectId, repartoIds) {
    const activeTemplates = templates.filter((item) => item.attivo !== false);
    const selectedTemplates = activeTemplates.filter((item) => !repartoIds.length || !item.reparto_id || repartoIds.includes(item.reparto_id));

    const rows = selectedTemplates.map((item, index) => ({
      progetto_id: projectId,
      titolo: item.titolo,
      reparto_id: item.reparto_id || null,
      stato: "da_evadere",
      priorita: null,
      assegnato_a: null,
      ordine: index + 1,
      creato_da: actorId,
      modificato_da: actorId,
    }));

    if (rows.length) {
      const { error } = await supabase.from("v4_fasi_progetto").insert(rows);
      if (error) alert(`Errore creazione checklist: ${error.message}`);
    }
  }

  async function saveAssociations(projectId, productIds, departmentIds) {
    await Promise.all([
      supabase.from("v4_progetto_prodotti").delete().eq("progetto_id", projectId),
      supabase.from("v4_progetto_reparti").delete().eq("progetto_id", projectId),
    ]);

    const productRows = safeArray(productIds).map((prodotto_id) => ({ progetto_id: projectId, prodotto_id }));
    const departmentRows = safeArray(departmentIds).map((reparto_id) => ({ progetto_id: projectId, reparto_id }));

    if (productRows.length) await supabase.from("v4_progetto_prodotti").insert(productRows);
    if (departmentRows.length) await supabase.from("v4_progetto_reparti").insert(departmentRows);
  }

  async function savePhaseProducts(phaseId, productIds) {
    await supabase.from("v4_fase_prodotti").delete().eq("fase_id", phaseId);

    const rows = safeArray(productIds).map((prodotto_id) => {
      const product = products.find((item) => item.id === prodotto_id);
      return {
        fase_id: phaseId,
        prodotto_id,
        prodotto_nome: product?.nome || null,
      };
    });

    if (rows.length) {
      const { error } = await supabase.from("v4_fase_prodotti").insert(rows);
      if (error) throw error;
    }
  }

  async function savePhase(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi per modificare le fasi.");
    if (!selectedProject?.id) return alert("Progetto non selezionato.");
    if (!phaseForm.titolo.trim()) return alert("Inserisci il titolo della fase.");

    setSaving(true);
    const payload = {
      progetto_id: selectedProject.id,
      titolo: phaseForm.titolo.trim(),
      descrizione: phaseForm.descrizione.trim() || null,
      note: phaseForm.note.trim() || null,
      priorita: null,
      deadline: phaseForm.deadline || null,
      reparto_id: phaseForm.reparto_id || null,
      assegnato_a: null,
      stato: phaseForm.stato || "da_evadere",
      modificato_da: actorId,
      updated_at: new Date().toISOString(),
    };

    if (!selectedPhase?.id) {
      payload.creato_da = actorId;
      payload.ordine = (phasesByProject.get(selectedProject.id) || []).length + 1;
    }

    const request = selectedPhase?.id
      ? supabase.from("v4_fasi_progetto").update(payload).eq("id", selectedPhase.id).select().single()
      : supabase.from("v4_fasi_progetto").insert(payload).select().single();

    const { data, error } = await request;
    setSaving(false);
    if (error) return alert(error.message);

    try {
      await savePhaseProducts(data?.id || selectedPhase?.id, phaseForm.prodotti);
    } catch (phaseProductError) {
      return alert(`Errore associazione prodotti fase: ${phaseProductError.message}`);
    }

    await log("fase_progetto", data?.id || selectedPhase?.id || selectedProject.id, selectedPhase?.id ? "modifica fase" : "nuova fase", payload.titolo);
    setPhaseModal(false);
    await loadData();
  }

  async function completePhase(phase) {
    if (!canManage) return alert("Non hai i permessi per completare le fasi.");

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("v4_fasi_progetto")
      .update({
        stato: "evaso",
        completato_da: actorId,
        completato_at: now,
        modificato_da: actorId,
        updated_at: now,
      })
      .eq("id", phase.id);

    if (error) return alert(error.message);
    await log("fase_progetto", phase.id, "fase evasa", phase.titolo);
    await loadData();
  }

  async function reopenPhase(phase) {
    if (!canManage) return alert("Non hai i permessi per riaprire le fasi.");
    const { error } = await supabase
      .from("v4_fasi_progetto")
      .update({ stato: "da_evadere", completato_da: null, completato_at: null, modificato_da: actorId, updated_at: new Date().toISOString() })
      .eq("id", phase.id);

    if (error) return alert(error.message);
    await log("fase_progetto", phase.id, "fase riaperta", phase.titolo);
    await loadData();
  }

  async function saveComment(e) {
    e.preventDefault();
    if (!selectedPhase?.id || !comment.trim()) return;

    const { data: authData, error: authError } = await supabase.auth.getUser();
    const authUserId = authData?.user?.id;

    if (authError || !authUserId) {
      return alert("Utente non autenticato. Effettua nuovamente il login.");
    }

    const { error } = await supabase.from("v4_commenti").insert({
      entity_type: "fase_progetto",
      entity_id: selectedPhase.id,
      testo: comment.trim(),
      creato_da: authUserId,
    });

    if (error) return alert(error.message);
    setComment("");
    await loadPhaseDetails(selectedPhase.id);
  }

  async function uploadAttachment(file) {
    if (!selectedPhase?.id || !file) return;

    const currentUtenteId = await getCurrentUtenteId();
    if (!currentUtenteId) {
      return alert("Utente non trovato nella tabella utenti. Verifica login e tabella utenti.");
    }

    const cleanFileName = file.name.replaceAll("/", "-");
    const path = `${currentUtenteId}/fasi/${selectedPhase.id}/${Date.now()}-${cleanFileName}`;

    const uploaded = await supabase.storage.from("allegati").upload(path, file, { upsert: true });
    if (uploaded.error) return alert(`Errore upload. Verifica bucket "allegati". ${uploaded.error.message}`);

    const { error } = await supabase.from("v4_allegati").insert({
      entity_type: "fase_progetto",
      entity_id: selectedPhase.id,
      file_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size || null,
      caricato_da: currentUtenteId,
    });

    if (error) return alert(error.message);
    await loadPhaseDetails(selectedPhase.id);
  }

  async function uploadAttachments(files) {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;

    for (const file of list) {
      await uploadAttachment(file);
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
    await uploadAttachments(e.dataTransfer?.files);
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

  function formatFileSize(bytes) {
    const value = Number(bytes || 0);
    if (!value) return "";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function removeAttachment(attachment) {
    if (!canManage) return alert("Non hai i permessi per eliminare gli allegati.");
    if (!attachment?.id) return;
    if (!window.confirm(`Vuoi eliminare l'allegato "${attachment.file_name || "file"}"?`)) return;

    if (attachment.file_path) {
      const storageDelete = await supabase.storage.from("allegati").remove([attachment.file_path]);
      if (storageDelete.error) return alert(`Errore eliminazione file: ${storageDelete.error.message}`);
    }

    const { error } = await supabase.from("v4_allegati").delete().eq("id", attachment.id);
    if (error) return alert(error.message);
    await loadPhaseDetails(selectedPhase.id);
  }

  async function removePhase(phase) {
    if (!canManage) return alert("Non hai i permessi.");
    if (!window.confirm("Vuoi eliminare questa fase?")) return;
    const { error } = await supabase.from("v4_fasi_progetto").delete().eq("id", phase.id);
    if (error) return alert(error.message);
    await log("fase_progetto", phase.id, "eliminazione fase", phase.titolo);
    await loadData();
  }

  async function log(entity_type, entity_id, azione, dettagli) {
    await supabase.from("v4_audit_log").insert({ entity_type, entity_id, azione, dettagli: { testo: dettagli || "" }, user_id: actorId });
  }

  function phaseUserName(userId) {
    return users.find((item) => item.id === userId)?.nome || "Non assegnato";
  }

  return (
    <div className="projects-page v4-page projects-v4-final">
      <div className="page-title-row">
        <div>
          <h1>Progetti</h1>
          <p>Ogni progetto contiene checklist, fasi, reparti, prodotti, allegati, commenti e storico.</p>
        </div>
        {canManage && (
          <button className="primary-action" onClick={() => openProject()}>
            <Plus size={18} /> Nuovo progetto
          </button>
        )}
      </div>

      <div className="v4-toolbar projects-toolbar-final">
        <div className="task-search">
          <Search size={18} />
          <input placeholder="Cerca progetto, prodotto, fase o reparto..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="status-tabs">
          {[
            ["tutti", "Tutti"],
            ["aperti", "Aperti"],
            ["oggi", "In scadenza oggi"],
            ["scaduti", "Scaduti"],
            ["completati", "Completati"],
          ].map(([value, label]) => (
            <button key={value} className={statusFilter === value ? "active" : ""} onClick={() => setStatusFilter(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="panel"><p>Caricamento progetti...</p></div>
      ) : filteredProjects.length === 0 ? (
        <div className="empty-state panel">
          <h3>Nessun progetto trovato</h3>
          <p>Crea un nuovo progetto o modifica i filtri di ricerca.</p>
        </div>
      ) : (
        <div className="project-board-horizontal">
          {filteredProjects.map((project) => {
            const projectPhases = phasesByProject.get(project.id) || [];
            const doneCount = projectPhases.filter(isDone).length;
            const productNames = productsByProject.get(project.id) || [];
            const departmentNames = departmentsByProject.get(project.id) || [];

            return (
              <section className="project-column" key={project.id}>
                <div className="project-column-header">
                  <button onClick={() => openProject(project)}>
                    <strong>{project.titolo}</strong>
                    <span>{project.descrizione || "Nessuna descrizione"}</span>
                  </button>
                  <small>{doneCount}/{projectPhases.length} fasi evase</small>
                  <div className="project-chip-row">
                    {productNames.slice(0, 3).map((name) => <em key={name}>{name}</em>)}
                    {departmentNames.slice(0, 3).map((name) => <em key={name}>{name}</em>)}
                  </div>
                </div>

                <div className="phase-list">
                  {projectPhases.map((phase) => (
                    <div className={`phase-card ${statusClass(phase)}`} key={phase.id}>
                      <button className="phase-card-main" onClick={() => openPhase(project, phase)}>
                        <strong>{phase.titolo}</strong>
                        <span>{phase.reparti?.nome || "Reparto non impostato"}</span>
                        {(productsByPhase.get(phase.id) || []).length > 0 && (
                          <small>Prodotti: {(productsByPhase.get(phase.id) || []).map((item) => item.nome).join(", ")}</small>
                        )}
                        <small>Deadline {formatDate(phase.deadline)} · {phase.stato || "Da evadere"}</small>
                      </button>
                      <div className="phase-card-actions">
                        {isDone(phase) ? (
                          <button className="reopen-phase-btn" onClick={() => reopenPhase(phase)}><Clock3 size={15} /> Riapri</button>
                        ) : (
                          <button className="complete-phase-btn" onClick={() => completePhase(phase)}><CheckCircle2 size={15} /> Completa</button>
                        )}
                        <button className="phase-icon-btn" onClick={() => openPhase(project, phase)} title="Modifica"><Edit3 size={15} /></button>
                        <button className="phase-icon-btn danger" onClick={() => removePhase(phase)} title="Elimina"><Trash2 size={15} /></button>
                      </div>
                    </div>
                  ))}

                  {canManage && <button className="add-phase-inline" onClick={() => openPhase(project)}><Plus size={16} /> Aggiungi fase</button>}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {projectModal && (
        <div className="modal-backdrop">
          <form className="modal-card v4-modal" onSubmit={saveProject}>
            <div className="modal-header">
              <h2>{selectedProject ? "Modifica progetto" : "Nuovo progetto"}</h2>
              <button type="button" onClick={() => setProjectModal(false)}><X size={20} /></button>
            </div>

            <label>Titolo<input value={projectForm.titolo} onChange={(e) => setProjectForm({ ...projectForm, titolo: e.target.value })} /></label>
            <label>Descrizione<textarea rows="4" value={projectForm.descrizione} onChange={(e) => setProjectForm({ ...projectForm, descrizione: e.target.value })} /></label>

            <div className="form-grid-2">
              <label>Priorità<select value={projectForm.priorita} onChange={(e) => setProjectForm({ ...projectForm, priorita: e.target.value })}><option>Bassa</option><option>Media</option><option>Alta</option></select></label>
              <label>Deadline<input type="date" value={projectForm.deadline} onChange={(e) => setProjectForm({ ...projectForm, deadline: e.target.value })} /></label>
            </div>

            <div className="checkbox-group scrollable-check-group">
              <strong>Prodotti associati</strong>
              {products.map((p) => <label key={p.id}><input type="checkbox" checked={projectForm.prodotti.includes(p.id)} onChange={() => toggleMulti(p.id, "prodotti")} />{p.nome}{p.codice ? ` · ${p.codice}` : ""}</label>)}
            </div>

            <div className="checkbox-group">
              <strong>Reparti associati / prepara check-list</strong>
              {departments.map((d) => <label key={d.id}><input type="checkbox" checked={projectForm.reparti.includes(d.id)} onChange={() => toggleMulti(d.id, "reparti")} />{d.nome}</label>)}
            </div>

            <button className="primary-action" disabled={saving}><Save size={18} /> {saving ? "Salvataggio..." : "Salva progetto"}</button>
          </form>
        </div>
      )}

      {phaseModal && (
        <div className="modal-backdrop">
          <form className="modal-card v4-modal large-modal" onSubmit={savePhase}>
            <div className="modal-header">
              <h2>{selectedPhase ? "Modifica task / fase" : "Nuova fase checklist"}</h2>
              <button type="button" onClick={() => setPhaseModal(false)}><X size={20} /></button>
            </div>

            <label>Checklist
              <select
                value={phaseForm.titolo}
                onChange={(e) => {
                  const selectedTemplate = templates.find((item) => item.titolo === e.target.value);
                  setPhaseForm({
                    ...phaseForm,
                    titolo: selectedTemplate?.titolo || "",
                    reparto_id: selectedTemplate?.reparto_id || "",
                  });
                }}
              >
                <option value="">Seleziona checklist...</option>
                {phaseForm.titolo && !templates.some((item) => item.titolo === phaseForm.titolo) && (
                  <option value={phaseForm.titolo}>{phaseForm.titolo}</option>
                )}
                {templates.map((item) => (
                  <option key={item.id} value={item.titolo}>
                    {item.titolo}{item.reparti?.nome ? ` · ${item.reparti.nome}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>Descrizione<textarea rows="3" value={phaseForm.descrizione} onChange={(e) => setPhaseForm({ ...phaseForm, descrizione: e.target.value })} /></label>
            <label>Note<textarea rows="3" value={phaseForm.note} onChange={(e) => setPhaseForm({ ...phaseForm, note: e.target.value })} /></label>

            <div className="form-grid-2">
              <label>Stato<select value={phaseForm.stato} onChange={(e) => setPhaseForm({ ...phaseForm, stato: e.target.value })}><option value="da_evadere">Da evadere</option><option value="in_lavorazione">In lavorazione</option><option value="in_valutazione">In valutazione</option><option value="evaso">Evaso</option></select></label>
              <label>Reparto<input disabled value={departments.find((d) => d.id === phaseForm.reparto_id)?.nome || ""} /></label>
            </div>

            <div className="checkbox-group scrollable-check-group">
              <strong>Prodotti associati alla fase</strong>
              {products.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={safeArray(phaseForm.prodotti).includes(p.id)}
                    onChange={() => togglePhaseProduct(p.id)}
                  />
                  {p.nome}{p.codice ? ` · ${p.codice}` : ""}
                </label>
              ))}
            </div>

            <label>Deadline<input type="date" value={phaseForm.deadline} onChange={(e) => setPhaseForm({ ...phaseForm, deadline: e.target.value })} /></label>

            {selectedPhase?.id && (
              <div className="phase-detail-extra">
                <div className="phase-extra-title"><MessageSquare size={18} /><strong>Commenti</strong></div>
                <div className="comments-box">
                  {comments.length === 0 ? <p className="muted">Nessun commento.</p> : comments.map((c) => <p key={c.id}><strong>{c.creato_da === actorId ? "Tu" : "Utente"}</strong> {c.testo}<small>{new Date(c.created_at).toLocaleString("it-IT")}</small></p>)}
                </div>
                <div className="comment-form-inline">
                  <input placeholder="Aggiungi commento..." value={comment} onChange={(e) => setComment(e.target.value)} />
                  <button type="button" onClick={saveComment}><MessageSquare size={16} /> Invia</button>
                </div>

                <div className="phase-extra-title"><FileText size={18} /><strong>Allegati</strong></div>
                <label
                  className={`upload-box ${dragActive ? "drag-active" : ""}`}
                  onDragEnter={handleAttachmentDrag}
                  onDragOver={handleAttachmentDrag}
                  onDragLeave={handleAttachmentDrag}
                  onDrop={handleAttachmentDrop}
                  style={{
                    border: dragActive ? "2px dashed #0b63ce" : undefined,
                    background: dragActive ? "rgba(11, 99, 206, 0.08)" : undefined,
                    cursor: "pointer",
                  }}
                >
                  <Paperclip size={18} />
                  {dragActive ? "Rilascia qui gli allegati" : "Carica allegato o trascina qui i file"}
                  <input
                    type="file"
                    multiple
                    hidden
                    onChange={async (e) => {
                      await uploadAttachments(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>

                <div className="attachments-list">
                  {attachments.length === 0 ? (
                    <span>Nessun allegato.</span>
                  ) : (
                    attachments.map((a) => {
                      const url = attachmentUrl(a);
                      const image = isImageAttachment(a);

                      return (
                        <div
                          key={a.id}
                          className="attachment-row"
                          style={{
                            display: "grid",
                            gridTemplateColumns: image ? "72px 1fr auto" : "1fr auto",
                            gap: "12px",
                            alignItems: "center",
                            padding: "10px 0",
                            borderBottom: "1px solid #eee",
                          }}
                        >
                          {image && (
                            <a href={url} target="_blank" rel="noopener noreferrer" title="Apri anteprima">
                              <img
                                src={url}
                                alt={a.file_name || "Allegato"}
                                style={{
                                  width: "64px",
                                  height: "64px",
                                  objectFit: "cover",
                                  borderRadius: "8px",
                                  border: "1px solid #ddd",
                                }}
                              />
                            </a>
                          )}

                          <div style={{ minWidth: 0 }}>
                            <strong style={{ display: "block", wordBreak: "break-word" }}>{a.file_name || "Allegato"}</strong>
                            <small className="muted">{formatFileSize(a.size_bytes)}</small>
                          </div>

                          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              download={a.file_name || true}
                              className="primary-action"
                              style={{ padding: "7px 12px", textDecoration: "none", fontSize: "13px" }}
                            >
                              Scarica
                            </a>

                            {canManage && (
                              <button
                                type="button"
                                className="phase-icon-btn danger"
                                onClick={() => removeAttachment(a)}
                                title="Elimina allegato"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            <button className="primary-action" disabled={saving}><Save size={18} /> {saving ? "Salvataggio..." : "Salva fase"}</button>
          </form>
        </div>
      )}
    </div>
  );
}

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
import PhaseChecklistModal from "../../components/PhaseChecklistModal";

const projectEmpty = {
  titolo: "",
  descrizione: "",
  deadline: "",
  prodotti: [],
  reparti: [],
  tipo_progetto_id: "",
};

const phaseEmpty = {
  titolo: "",
  descrizione: "",
  note: "",
  deadline: "",
  reparto_id: "",
  reparto_ids: [],
  stato: "da_evadere",
  prodotti: [],
  bloccante_id: "",
};

const quickProductEmpty = {
  nome: "",
  codice: "",
  brand: "",
  categoria: "",
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

function getBlockingPhase(item, list) {
  if (!item?.bloccante_id) return null;
  return safeArray(list).find((phase) => phase.id === item.bloccante_id) || null;
}

export default function Projects() {
  const { profile, hasPermission, isAdmin, userDepartmentIds = [] } = useAuth();
  const canManage = hasPermission("projects.write");
  const canReadAllProjects = hasPermission("projects.read.all") || isAdmin?.();
  const canReadAllTasksInVisibleProjects = canReadAllProjects || hasPermission("tasks.read.project_departments") || hasPermission("tasks.read.all");
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
  const [projectTypes, setProjectTypes] = useState([]);
  const [projectTypePhases, setProjectTypePhases] = useState([]);
  const [projectProducts, setProjectProducts] = useState([]);
  const [projectDepartments, setProjectDepartments] = useState([]);
  const [phaseProducts, setPhaseProducts] = useState([]);
  const [templateDepartments, setTemplateDepartments] = useState([]);
  const [phaseDepartments, setPhaseDepartments] = useState([]);

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
  const [showPhaseProducts, setShowPhaseProducts] = useState(false);
  const [projectProductQuery, setProjectProductQuery] = useState("");
  const [quickProductModal, setQuickProductModal] = useState(false);
  const [quickProductForm, setQuickProductForm] = useState(quickProductEmpty);
  const [savingQuickProduct, setSavingQuickProduct] = useState(false);

  useEffect(() => {
    if (profile?.id) loadData();
  }, [profile?.id, userDepartmentIds.join(",")]);

  useEffect(() => {
    if (selectedPhase?.id) loadPhaseDetails(selectedPhase.id);
    else {
      setComments([]);
      setAttachments([]);
    }
  }, [selectedPhase?.id]);

  async function loadData() {
    setLoading(true);
    const [projectsRes, phasesRes, productsRes, departmentsRes, usersRes, templatesRes, ppRes, prRes, fpRes, templateDepartmentsRes, phaseDepartmentsRes, projectTypesRes, projectTypePhasesRes] = await Promise.all([
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
      supabase.from("checklist_template_reparti").select("id,template_id,reparto_id"),
      supabase.from("v4_fase_reparti").select("id,fase_id,reparto_id,completato,completato_at,completato_da"),
      supabase.from("tipi_progetto").select("id,nome,descrizione,attivo").order("nome"),
      supabase.from("tipo_progetto_fasi").select("id,tipo_progetto_id,template_id,giorni_anticipo,ordine,obbligatoria").order("ordine", { ascending: true }),
    ]);

    if (projectsRes.error) console.error("Progetti:", projectsRes.error.message);
    if (phasesRes.error) console.error("Fasi:", phasesRes.error.message);
    if (templateDepartmentsRes.error) console.error("Reparti checklist:", templateDepartmentsRes.error.message);
    if (phaseDepartmentsRes.error) console.error("Reparti fase:", phaseDepartmentsRes.error.message);

    const allProjects = projectsRes.data || [];
    const allPhases = phasesRes.data || [];
    const allProjectDepartments = prRes.data || [];
    const allowedDepartmentIds = userDepartmentIds || [];

    const visibleProjectIds = new Set(
      canReadAllProjects
        ? allProjects.map((project) => project.id)
        : allProjects
            .filter((project) => {
              const projectDepartmentIds = allProjectDepartments
                .filter((row) => row.progetto_id === project.id)
                .map((row) => row.reparto_id)
                .filter(Boolean);

              if (projectDepartmentIds.length === 0) return true;
              return projectDepartmentIds.some((repartoId) => allowedDepartmentIds.includes(repartoId));
            })
            .map((project) => project.id)
    );

    const visibleProjects = allProjects.filter((project) => visibleProjectIds.has(project.id));
    const allPhaseDepartments = phaseDepartmentsRes.data || [];
    const visiblePhases = (canReadAllProjects || canReadAllTasksInVisibleProjects)
      ? allPhases.filter((phase) => visibleProjectIds.has(phase.progetto_id))
      : allPhases.filter((phase) => {
          if (!visibleProjectIds.has(phase.progetto_id)) return false;
          const phaseDepartmentIds = allPhaseDepartments
            .filter((row) => row.fase_id === phase.id)
            .map((row) => row.reparto_id)
            .filter(Boolean);
          if (phaseDepartmentIds.length > 0) return phaseDepartmentIds.some((id) => allowedDepartmentIds.includes(id));
          if (!phase.reparto_id) return true;
          return allowedDepartmentIds.includes(phase.reparto_id);
        });

    setProjects(visibleProjects);
    setPhases(visiblePhases);
    setProducts((productsRes.data || []).filter((item) => item.id));
    setDepartments((departmentsRes.data || []).filter((item) => item.attivo !== false));
    setUsers((usersRes.data || []).filter((item) => item.attivo !== false));
    setTemplates((templatesRes.data || []).filter((item) => item.attivo !== false));
    setProjectProducts((ppRes.data || []).filter((row) => visibleProjectIds.has(row.progetto_id)));
    setProjectDepartments((prRes.data || []).filter((row) => visibleProjectIds.has(row.progetto_id)));
    setPhaseProducts((fpRes.data || []).filter((row) => visiblePhases.some((phase) => phase.id === row.fase_id)));
    setTemplateDepartments(templateDepartmentsRes.data || []);
    setProjectTypes((projectTypesRes.data || []).filter((item) => item.attivo !== false));
    setProjectTypePhases(projectTypePhasesRes.data || []);
    setPhaseDepartments((phaseDepartmentsRes.data || []).filter((row) => visiblePhases.some((phase) => phase.id === row.fase_id)));
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
      list.sort((a, b) => {
        const ad = a.deadline || "9999-12-31";
        const bd = b.deadline || "9999-12-31";
        if (ad !== bd) return ad.localeCompare(bd);
        return Number(a.ordine || 0) - Number(b.ordine || 0);
      });
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

  const departmentsByTemplate = useMemo(() => {
    const map = new Map();
    templateDepartments.forEach((row) => {
      const list = map.get(row.template_id) || [];
      const department = departments.find((item) => item.id === row.reparto_id);
      if (department) list.push(department);
      map.set(row.template_id, list);
    });
    return map;
  }, [templateDepartments, departments]);

  const departmentsByPhase = useMemo(() => {
    const map = new Map();
    phaseDepartments.forEach((row) => {
      const list = map.get(row.fase_id) || [];
      const department = departments.find((item) => item.id === row.reparto_id);
      if (department) {
        list.push({
          ...department,
          fase_reparto_id: row.id,
          completato: Boolean(row.completato),
          completato_at: row.completato_at,
          completato_da: row.completato_da,
        });
      }
      map.set(row.fase_id, list);
    });
    return map;
  }, [phaseDepartments, departments]);

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

  const filteredProjectProducts = useMemo(() => {
    const text = projectProductQuery.trim().toLowerCase();
    if (!text) return products;
    return products.filter((product) =>
      `${product.nome || ""} ${product.codice || ""} ${product.brand || ""} ${product.categoria || ""}`
        .toLowerCase()
        .includes(text)
    );
  }, [products, projectProductQuery]);

  function getProjectProductIds(projectId) {
    return projectProducts.filter((row) => row.progetto_id === projectId && row.prodotto_id).map((row) => row.prodotto_id);
  }

  function getProjectDepartmentIds(projectId) {
    return projectDepartments.filter((row) => row.progetto_id === projectId && row.reparto_id).map((row) => row.reparto_id);
  }

  function getPhaseProductIds(phaseId) {
    return phaseProducts.filter((row) => row.fase_id === phaseId && row.prodotto_id).map((row) => row.prodotto_id);
  }

  function getTemplateDepartmentIds(templateId) {
    return templateDepartments.filter((row) => row.template_id === templateId && row.reparto_id).map((row) => row.reparto_id);
  }

  function getPhaseDepartmentIds(phaseId) {
    return phaseDepartments.filter((row) => row.fase_id === phaseId && row.reparto_id).map((row) => row.reparto_id);
  }

  function getProjectTypeDepartmentIds(projectTypeId) {
    if (!projectTypeId) return [];

    const templateIds = projectTypePhases
      .filter((row) => row.tipo_progetto_id === projectTypeId && row.template_id)
      .map((row) => row.template_id);

    const departmentIds = templateIds.flatMap((templateId) => {
      const ids = getTemplateDepartmentIds(templateId);
      if (ids.length) return ids;

      const template = templates.find((item) => item.id === templateId);
      return [template?.reparto_id].filter(Boolean);
    });

    return [...new Set(departmentIds.filter(Boolean))];
  }

  function openProject(project = null) {
    setSelectedProject(project);
    setProjectProductQuery("");
    setProjectForm(
      project
        ? {
            titolo: project.titolo || "",
            descrizione: project.descrizione || "",
            deadline: project.deadline || "",
            prodotti: getProjectProductIds(project.id),
            reparti: getProjectDepartmentIds(project.id),
            tipo_progetto_id: project.tipo_progetto_id || "",
          }
        : { ...projectEmpty }
    );
    setProjectModal(true);
  }

  function openPhase(project, phase = null) {
    setSelectedProject(project);
    setSelectedPhase(phase);
    const projectProductIds = project?.id ? getProjectProductIds(project.id) : [];
    const projectDepartmentIds = project?.id ? getProjectDepartmentIds(project.id) : [];
    setPhaseForm(
      phase
        ? {
            titolo: phase.titolo || "",
            descrizione: phase.descrizione || "",
            note: phase.note || "",
            deadline: phase.deadline || "",
            reparto_id: phase.reparto_id || "",
            reparto_ids: getPhaseDepartmentIds(phase.id).length ? getPhaseDepartmentIds(phase.id) : (phase.reparto_id ? [phase.reparto_id] : []),
            stato: phase.stato || "da_evadere",
            prodotti: getPhaseProductIds(phase.id),
            bloccante_id: phase.bloccante_id || "",
          }
        : { ...phaseEmpty, prodotti: projectProductIds, reparto_ids: projectDepartmentIds, reparto_id: projectDepartmentIds[0] || "" }
    );
    setShowPhaseProducts(false);
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

  function togglePhaseDepartment(departmentId) {
    setPhaseForm((current) => {
      const currentIds = safeArray(current.reparto_ids);
      const nextIds = currentIds.includes(departmentId)
        ? currentIds.filter((id) => id !== departmentId)
        : [...currentIds, departmentId];
      return { ...current, reparto_ids: nextIds, reparto_id: nextIds[0] || "" };
    });
  }

  function openQuickProductModal() {
    if (!canManage) return alert("Non hai i permessi per creare prodotti.");
    setQuickProductForm({ ...quickProductEmpty, nome: projectProductQuery.trim() });
    setQuickProductModal(true);
  }

  function updateQuickProductForm(field, value) {
    setQuickProductForm((current) => ({ ...current, [field]: value }));
  }

  async function saveQuickProduct(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi per creare prodotti.");
    if (!quickProductForm.nome.trim()) return alert("Inserisci il nome del prodotto.");

    setSavingQuickProduct(true);
    const payload = {
      nome: quickProductForm.nome.trim(),
      codice: quickProductForm.codice.trim() || null,
      brand: quickProductForm.brand.trim() || null,
      categoria: quickProductForm.categoria.trim() || null,
      stato: "Attivo",
      attivo: true,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from("prodotti").insert(payload).select("id,nome,codice,brand,categoria").single();
    setSavingQuickProduct(false);
    if (error) return alert(error.message);

    if (data?.id) {
      setProducts((current) => [...current, data].sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""))));
      setProjectForm((current) => ({
        ...current,
        prodotti: safeArray(current.prodotti).includes(data.id) ? current.prodotti : [...safeArray(current.prodotti), data.id],
      }));
      setProjectProductQuery("");
    }

    setQuickProductModal(false);
    setQuickProductForm(quickProductEmpty);
  }

  async function saveProject(e) {
    e.preventDefault();
    if (!canManage) return alert("Non hai i permessi per modificare i progetti.");
    if (!projectForm.titolo.trim()) return alert("Inserisci il titolo del progetto.");
    if (!selectedProject?.id && projectForm.tipo_progetto_id && !projectForm.deadline) {
      return alert("Per generare le fasi dal tipo progetto devi inserire la deadline del progetto.");
    }

    setSaving(true);
    const payload = {
      titolo: projectForm.titolo.trim(),
      descrizione: projectForm.descrizione.trim() || null,
      priorita: null,
      deadline: projectForm.deadline || null,
      tipo_progetto_id: projectForm.tipo_progetto_id || null,
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
    const automaticDepartmentIds = getProjectTypeDepartmentIds(projectForm.tipo_progetto_id);
    const projectDepartmentIds = [...new Set([
      ...safeArray(projectForm.reparti),
      ...automaticDepartmentIds,
    ])];

    await saveAssociations(projectId, projectForm.prodotti, projectDepartmentIds);

    if (!selectedProject?.id && projectForm.tipo_progetto_id) {
      await createProjectTypePhases(projectId, projectForm.tipo_progetto_id, projectForm.deadline, projectForm.prodotti);
    }

    await log("progetto", projectId, selectedProject?.id ? "modifica progetto" : "creazione progetto", payload.titolo);
    setSaving(false);
    setProjectModal(false);
    await loadData();
  }

  function subtractDaysIso(dateValue, days) {
    if (!dateValue) return null;
    const [year, month, day] = String(dateValue).slice(0, 10).split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() - Number(days || 0));
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  async function createProjectTypePhases(projectId, projectTypeId, projectDeadline, productIds) {
    const rules = projectTypePhases
      .filter((row) => row.tipo_progetto_id === projectTypeId)
      .sort((a, b) => Number(a.ordine || 0) - Number(b.ordine || 0));

    for (const [index, rule] of rules.entries()) {
      const template = templates.find((item) => item.id === rule.template_id);
      if (!template) continue;

      const templateDepartmentIds = getTemplateDepartmentIds(template.id);
      const effectiveDepartmentIds = templateDepartmentIds.length
        ? templateDepartmentIds
        : [template.reparto_id].filter(Boolean);

      const { data, error } = await supabase
        .from("v4_fasi_progetto")
        .insert({
          progetto_id: projectId,
          titolo: template.titolo,
          reparto_id: effectiveDepartmentIds[0] || null,
          stato: "da_evadere",
          priorita: null,
          assegnato_a: null,
          ordine: Number(rule.ordine || index + 1),
          deadline: subtractDaysIso(projectDeadline, rule.giorni_anticipo),
          creato_da: actorId,
          modificato_da: actorId,
        })
        .select("id")
        .single();

      if (error) throw error;
      if (data?.id && effectiveDepartmentIds.length) await savePhaseDepartments(data.id, effectiveDepartmentIds);
      if (data?.id && safeArray(productIds).length) await savePhaseProducts(data.id, productIds);
    }
  }

  async function createTemplatePhases(projectId, repartoIds) {
    const activeTemplates = templates.filter((item) => item.attivo !== false);
    const selectedTemplates = activeTemplates.filter((item) => {
      const templateDepartmentIds = getTemplateDepartmentIds(item.id);
      if (!repartoIds.length) return true;
      if (templateDepartmentIds.length === 0 && !item.reparto_id) return true;
      const ids = templateDepartmentIds.length ? templateDepartmentIds : [item.reparto_id].filter(Boolean);
      return ids.some((id) => repartoIds.includes(id));
    });

    for (const [index, item] of selectedTemplates.entries()) {
      const templateDepartmentIds = getTemplateDepartmentIds(item.id);
      const ids = templateDepartmentIds.length ? templateDepartmentIds : [item.reparto_id].filter(Boolean);
      const effectiveDepartmentIds = ids.length ? ids : repartoIds;

      const { data, error } = await supabase
        .from("v4_fasi_progetto")
        .insert({
          progetto_id: projectId,
          titolo: item.titolo,
          reparto_id: effectiveDepartmentIds[0] || null,
          stato: "da_evadere",
          priorita: null,
          assegnato_a: null,
          ordine: index + 1,
              modificato_da: actorId,
        })
        .select("id")
        .single();

      if (error) {
        alert(`Errore creazione checklist: ${error.message}`);
        continue;
      }

      if (data?.id && effectiveDepartmentIds.length) {
        await savePhaseDepartments(data.id, effectiveDepartmentIds);
      }
      if (data?.id) {
        await savePhaseProducts(data.id, getProjectProductIds(projectId));
      }
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

  async function savePhaseDepartments(phaseId, departmentIds) {
    const uniqueIds = [...new Set(safeArray(departmentIds).filter(Boolean))];

    const { data: existingRows, error: existingError } = await supabase
      .from("v4_fase_reparti")
      .select("id,fase_id,reparto_id,completato,completato_at,completato_da")
      .eq("fase_id", phaseId);

    if (existingError) throw existingError;

    const existing = existingRows || [];
    const existingIds = existing.map((row) => row.reparto_id).filter(Boolean);
    const idsToDelete = existingIds.filter((id) => !uniqueIds.includes(id));
    const idsToInsert = uniqueIds.filter((id) => !existingIds.includes(id));

    if (idsToDelete.length) {
      const { error } = await supabase
        .from("v4_fase_reparti")
        .delete()
        .eq("fase_id", phaseId)
        .in("reparto_id", idsToDelete);
      if (error) throw error;
    }

    if (idsToInsert.length) {
      const rows = idsToInsert.map((reparto_id) => ({ fase_id: phaseId, reparto_id, completato: false }));
      const { error } = await supabase.from("v4_fase_reparti").insert(rows);
      if (error) throw error;
    }

    if (!uniqueIds.length) {
      const { error } = await supabase.from("v4_fase_reparti").delete().eq("fase_id", phaseId);
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
      reparto_id: safeArray(phaseForm.reparto_ids)[0] || phaseForm.reparto_id || null,
      assegnato_a: null,
      stato: phaseForm.stato || "da_evadere",
      bloccante_id: phaseForm.bloccante_id || null,
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
      await savePhaseDepartments(data?.id || selectedPhase?.id, phaseForm.reparto_ids);
    } catch (phaseProductError) {
      return alert(`Errore associazione fase: ${phaseProductError.message}`);
    }

    await log("fase_progetto", data?.id || selectedPhase?.id || selectedProject.id, selectedPhase?.id ? "modifica fase" : "nuova fase", payload.titolo);
    setPhaseModal(false);
    await loadData();
  }

  async function completePhase(phase) {
    const blocker = getBlockingPhase(phase, phases);
    if (blocker && !isDone(blocker)) return alert(`Questa fase è bloccata da: ${blocker.titolo || "fase bloccante"}. Completa prima la fase bloccante.`);
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

    const phaseDepartmentRows = phaseDepartments.filter((row) => row.fase_id === phase.id);
    if (phaseDepartmentRows.length > 0) {
      const resetDepartments = await supabase
        .from("v4_fase_reparti")
        .update({
          completato: false,
          completato_at: null,
          completato_da: null,
        })
        .eq("fase_id", phase.id);

      if (resetDepartments.error) return alert(resetDepartments.error.message);
    }

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

  async function deletePhaseCompletely(phase, options = {}) {
    if (!phase?.id) return false;

    const { data: files, error: filesError } = await supabase
      .from("v4_allegati")
      .select("file_path")
      .eq("entity_type", "fase_progetto")
      .eq("entity_id", phase.id);

    if (filesError) {
      alert(filesError.message);
      return false;
    }

    const paths = (files || []).map((file) => file.file_path).filter(Boolean);

    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from("allegati")
        .remove(paths);

      if (storageError) {
        alert(`Errore eliminazione file fisici: ${storageError.message}`);
        return false;
      }
    }

    const deleteSteps = [
      supabase.from("v4_commenti").delete().eq("entity_type", "fase_progetto").eq("entity_id", phase.id),
      supabase.from("v4_allegati").delete().eq("entity_type", "fase_progetto").eq("entity_id", phase.id),
      supabase.from("v4_fase_reparti").delete().eq("fase_id", phase.id),
      supabase.from("v4_fase_prodotti").delete().eq("fase_id", phase.id),
      supabase.from("v4_audit_log").delete().eq("entity_type", "fase_progetto").eq("entity_id", phase.id),
    ];

    for (const step of deleteSteps) {
      const { error } = await step;
      if (error) {
        alert(error.message);
        return false;
      }
    }

    const { error } = await supabase.from("v4_fasi_progetto").delete().eq("id", phase.id);
    if (error) {
      alert(error.message);
      return false;
    }

    if (options.closeModal) {
      setPhaseModal(false);
      setSelectedPhase(null);
    }

    if (options.reload !== false) {
      await loadData();
    }
    return true;
  }

  async function deleteProjectCompletely(project) {
    if (!project?.id) return false;

    const projectPhases = phases.filter((phase) => phase.progetto_id === project.id);
    const phaseIds = projectPhases.map((phase) => phase.id).filter(Boolean);

    for (const phase of projectPhases) {
      const deleted = await deletePhaseCompletely(phase, { reload: false });
      if (!deleted) return false;
    }

    const { data: projectFiles, error: projectFilesError } = await supabase
      .from("v4_allegati")
      .select("file_path")
      .eq("entity_type", "progetto")
      .eq("entity_id", project.id);

    if (projectFilesError) {
      alert(projectFilesError.message);
      return false;
    }

    const projectPaths = (projectFiles || []).map((file) => file.file_path).filter(Boolean);
    if (projectPaths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from("allegati")
        .remove(projectPaths);

      if (storageError) {
        alert(`Errore eliminazione file fisici progetto: ${storageError.message}`);
        return false;
      }
    }

    const deleteSteps = [
      supabase.from("v4_commenti").delete().eq("entity_type", "progetto").eq("entity_id", project.id),
      supabase.from("v4_allegati").delete().eq("entity_type", "progetto").eq("entity_id", project.id),
      supabase.from("v4_progetto_prodotti").delete().eq("progetto_id", project.id),
      supabase.from("v4_progetto_reparti").delete().eq("progetto_id", project.id),
      supabase.from("v4_audit_log").delete().eq("entity_type", "progetto").eq("entity_id", project.id),
    ];

    if (phaseIds.length > 0) {
      deleteSteps.push(
        supabase.from("v4_audit_log").delete().eq("entity_type", "fase_progetto").in("entity_id", phaseIds)
      );
    }

    for (const step of deleteSteps) {
      const { error } = await step;
      if (error) {
        alert(error.message);
        return false;
      }
    }

    const { error } = await supabase.from("v4_progetti").delete().eq("id", project.id);
    if (error) {
      alert(error.message);
      return false;
    }

    if (selectedProject?.id === project.id) {
      setSelectedProject(null);
      setProjectModal(false);
      setPhaseModal(false);
      setSelectedPhase(null);
    }

    await loadData();
    return true;
  }

  async function removePhase(phase) {
    if (!canManage) return alert("Non hai i permessi.");
    if (!window.confirm("Vuoi eliminare questa fase?\n\nVerranno eliminati anche commenti, allegati, reparti, prodotti, storico e file fisici collegati.")) return;
    await deletePhaseCompletely(phase);
  }

  async function removeProject(project) {
    if (!canManage) return alert("Non hai i permessi.");
    if (!project?.id) return;
    const projectPhases = phases.filter((phase) => phase.progetto_id === project.id);
    if (!window.confirm(`Vuoi eliminare il progetto "${project.titolo || "senza titolo"}"?\n\nVerranno eliminate anche ${projectPhases.length} fasi/task collegate, tutti i commenti, allegati, reparti, prodotti, storico e file fisici delle fasi.\n\nOperazione non reversibile.`)) return;
    await deleteProjectCompletely(project);
  }

  async function removeSelectedPhase() {
    if (!canManage) return alert("Non hai i permessi.");
    if (!selectedPhase?.id) return;
    if (!window.confirm("Vuoi eliminare questa fase?\n\nVerranno eliminati anche commenti, allegati, reparti, prodotti, storico e file fisici collegati.")) return;
    await deletePhaseCompletely(selectedPhase, { closeModal: true });
  }

  async function log(entity_type, entity_id, azione, dettagli) {
    await supabase.from("v4_audit_log").insert({ entity_type, entity_id, azione, dettagli: { testo: dettagli || "" }, user_id: actorId });
  }

  function phaseUserName(userId) {
    return users.find((item) => item.id === userId)?.nome || "Non assegnato";
  }

  function canCompleteDepartment(departmentId) {
    if (canManage || canReadAllProjects || hasPermission("tasks.complete.any_department")) return true;
    if (hasPermission("tasks.complete.own_department")) {
      return safeArray(userDepartmentIds).includes(departmentId);
    }
    return safeArray(userDepartmentIds).includes(departmentId);
  }

  async function completeDepartmentPhase(phase, department) {
    if (!phase?.id || !department?.id) return;
    const blocker = getBlockingPhase(phase, phases);
    if (blocker && !isDone(blocker)) return alert(`Questa fase è bloccata da: ${blocker.titolo || "fase bloccante"}. Completa prima la fase bloccante.`);

    if (!canCompleteDepartment(department.id)) {
      return alert("Non hai i permessi per completare questo reparto.");
    }

    const now = new Date().toISOString();

    const { error } = await supabase
      .from("v4_fase_reparti")
      .update({
        completato: true,
        completato_at: now,
        completato_da: actorId,
      })
      .eq("fase_id", phase.id)
      .eq("reparto_id", department.id);

    if (error) return alert(error.message);

    const { data: rows, error: rowsError } = await supabase
      .from("v4_fase_reparti")
      .select("reparto_id,completato")
      .eq("fase_id", phase.id);

    if (rowsError) return alert(rowsError.message);

    const allCompleted = (rows || []).length > 0 && (rows || []).every((row) => Boolean(row.completato));

    const phasePayload = allCompleted
      ? {
          stato: "evaso",
          completato_da: actorId,
          completato_at: now,
          modificato_da: actorId,
          updated_at: now,
        }
      : {
          stato: "in_lavorazione",
          completato_da: null,
          completato_at: null,
          modificato_da: actorId,
          updated_at: now,
        };

    const { error: phaseError } = await supabase
      .from("v4_fasi_progetto")
      .update(phasePayload)
      .eq("id", phase.id);

    if (phaseError) return alert(phaseError.message);

    await log(
      "fase_progetto",
      phase.id,
      allCompleted ? "fase evasa da tutti i reparti" : "reparto completato",
      `${phase.titolo || "Fase"} · ${department.nome}`
    );

    await loadData();
  }

  async function reopenDepartmentPhase(phase, department) {
    if (!phase?.id || !department?.id) return;

    if (!canManage && !hasPermission("tasks.reopen")) {
      return alert("Non hai i permessi per riaprire questo reparto.");
    }

    const now = new Date().toISOString();

    const { error } = await supabase
      .from("v4_fase_reparti")
      .update({
        completato: false,
        completato_at: null,
        completato_da: null,
      })
      .eq("fase_id", phase.id)
      .eq("reparto_id", department.id);

    if (error) return alert(error.message);

    const { error: phaseError } = await supabase
      .from("v4_fasi_progetto")
      .update({
        stato: "in_lavorazione",
        completato_da: null,
        completato_at: null,
        modificato_da: actorId,
        updated_at: now,
      })
      .eq("id", phase.id);

    if (phaseError) return alert(phaseError.message);

    await log("fase_progetto", phase.id, "reparto riaperto", `${phase.titolo || "Fase"} · ${department.nome}`);
    await loadData();
  }

  return (
    <div className="projects-page v4-page projects-v4-final">
      <div className="page-title-row">
        <div>
          <h1>Progetti</h1>
          <p>Tutti i progetti del mio reparto.</p>
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
                  {projectPhases.map((phase) => {
                    const blocker = getBlockingPhase(phase, phases);
                    const blocked = blocker && !isDone(blocker);
                    return (
                    <div className={`phase-card ${statusClass(phase)} ${blocked ? "blocked" : ""}`} key={phase.id}>
                      <button className="phase-card-main" onClick={() => openPhase(project, phase)}>
                        <strong>{phase.titolo}</strong>
                        <span>{(departmentsByPhase.get(phase.id) || []).map((d) => d.nome).join(", ") || phase.reparti?.nome || "Reparto non impostato"}</span>
                        {(productsByPhase.get(phase.id) || []).length > 0 && (
                          <small>Prodotti: {(productsByPhase.get(phase.id) || []).map((item) => item.nome).join(", ")}</small>
                        )}
                        <small>Deadline {formatDate(phase.deadline)} · {blocked ? "Bloccata" : phase.stato || "Da evadere"}</small>
                        {blocker && <small className={blocked ? "danger" : "done"}>Fase bloccante: {blocker.titolo || "fase"}{blocked ? " · da completare" : " · completata"}</small>}
                      </button>
                      <div className="phase-card-actions">
                        {(departmentsByPhase.get(phase.id) || []).length > 0 ? (
                          <div
                            className="department-completion-actions"
                            style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}
                          >
                            {(departmentsByPhase.get(phase.id) || []).map((department) =>
                              department.completato ? (
                                <button
                                  key={department.id}
                                  type="button"
                                  className="reopen-phase-btn"
                                  onClick={() => reopenDepartmentPhase(phase, department)}
                                  title={department.completato_at ? `Completato il ${new Date(department.completato_at).toLocaleString("it-IT")}` : "Reparto completato"}
                                >
                                  <CheckCircle2 size={15} /> {department.nome} completato
                                </button>
                              ) : (
                                <button
                                  key={department.id}
                                  type="button"
                                  className="complete-phase-btn"
                                  onClick={() => completeDepartmentPhase(phase, department)}
                                  disabled={blocked || !canCompleteDepartment(department.id)}
                                  title={!canCompleteDepartment(department.id) ? "Non puoi completare questo reparto" : `Completa ${department.nome}`}
                                >
                                  <CheckCircle2 size={15} /> Completa {department.nome}
                                </button>
                              )
                            )}
                          </div>
                        ) : isDone(phase) ? (
                          <button className="reopen-phase-btn" onClick={() => reopenPhase(phase)}><Clock3 size={15} /> Riapri</button>
                        ) : (
                          <button className="complete-phase-btn" onClick={() => completePhase(phase)} disabled={blocked}><CheckCircle2 size={15} /> Completa</button>
                        )}
                        <button className="phase-icon-btn" onClick={() => openPhase(project, phase)} title="Modifica"><Edit3 size={15} /></button>
                        <button className="phase-icon-btn danger" onClick={() => removePhase(phase)} title="Elimina"><Trash2 size={15} /></button>
                      </div>
                    </div>
                    );
                  })}

                  {canManage && <button className="add-phase-inline" onClick={() => openPhase(project)}><Plus size={16} /> Aggiungi fase</button>}
                  {canManage && (
                    <button className="add-phase-inline danger" onClick={() => removeProject(project)}>
                      <Trash2 size={16} /> Elimina progetto
                    </button>
                  )}
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

            <label>Tipo progetto
              <select value={projectForm.tipo_progetto_id} onChange={(e) => setProjectForm({ ...projectForm, tipo_progetto_id: e.target.value })}>
                <option value="">Nessun tipo progetto</option>
                {projectTypes.map((type) => <option key={type.id} value={type.id}>{type.nome}</option>)}
              </select>
            </label>

            <label>Deadline<input type="date" value={projectForm.deadline} onChange={(e) => setProjectForm({ ...projectForm, deadline: e.target.value })} /></label>

            <div className="checkbox-group scrollable-check-group">
              <strong>Prodotti associati</strong>
              <div className="v4-toolbar" style={{ margin: "8px 0 10px", padding: 0, gap: "10px" }}>
                <div className="task-search">
                  <Search size={18} />
                  <input
                    placeholder="Cerca prodotto per nome, codice, brand..."
                    value={projectProductQuery}
                    onChange={(e) => setProjectProductQuery(e.target.value)}
                  />
                </div>
                <button type="button" className="secondary-action" onClick={openQuickProductModal}>
                  <Plus size={18} /> Crea nuovo prodotto
                </button>
              </div>
              {filteredProjectProducts.length === 0 ? (
                <p className="empty-text">Nessun prodotto trovato.</p>
              ) : (
                filteredProjectProducts.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      checked={safeArray(projectForm.prodotti).includes(p.id)}
                      onChange={() => toggleMulti(p.id, "prodotti")}
                    />
                    {p.nome}{p.codice ? ` · ${p.codice}` : ""}
                  </label>
                ))
              )}
            </div>

            <div className="checkbox-group">
              <strong>Reparti associati / prepara check-list</strong>
              {departments.map((d) => <label key={d.id}><input type="checkbox" checked={projectForm.reparti.includes(d.id)} onChange={() => toggleMulti(d.id, "reparti")} />{d.nome}</label>)}
            </div>

            <button className="primary-action" disabled={saving}><Save size={18} /> {saving ? "Salvataggio..." : "Salva progetto"}</button>
          </form>
        </div>
      )}

      {quickProductModal && (
        <div className="modal-backdrop">
          <form className="modal-card v4-modal" onSubmit={saveQuickProduct}>
            <div className="modal-header">
              <h2>Crea nuovo prodotto</h2>
              <button type="button" onClick={() => setQuickProductModal(false)}><X size={20} /></button>
            </div>

            <label>Nome *<input value={quickProductForm.nome} onChange={(e) => updateQuickProductForm("nome", e.target.value)} autoFocus /></label>
            <div className="form-grid-2">
              <label>Codice<input value={quickProductForm.codice} onChange={(e) => updateQuickProductForm("codice", e.target.value)} /></label>
              <label>Brand<input value={quickProductForm.brand} onChange={(e) => updateQuickProductForm("brand", e.target.value)} /></label>
              <label>Categoria<input value={quickProductForm.categoria} onChange={(e) => updateQuickProductForm("categoria", e.target.value)} /></label>
            </div>

            <div className="dashboard-message-actions">
              <button type="button" className="secondary-action" onClick={() => setQuickProductModal(false)}>Annulla</button>
              <button type="submit" className="primary-action" disabled={savingQuickProduct}>
                <Save size={18} /> {savingQuickProduct ? "Salvataggio..." : "Salva e associa"}
              </button>
            </div>
          </form>
        </div>
      )}

      <PhaseChecklistModal
        open={phaseModal}
        phase={selectedPhase}
        initialDate={phaseForm.deadline || selectedProject?.deadline || todayIso()}
        initialProjectId={selectedProject?.id || ""}
        initialProductIds={selectedProject?.id ? getProjectProductIds(selectedProject.id) : []}
        projects={projects}
        departments={departments}
        products={products}
        phaseDepartments={phaseDepartments}
        phaseProducts={phaseProducts}
        templates={templates}
        templateDepartments={templateDepartments}
        allPhases={phases}
        canManage={canManage}
        canCompleteDepartment={canCompleteDepartment}
        onClose={() => setPhaseModal(false)}
        onSaved={loadData}
      />
    </div>
  );
}

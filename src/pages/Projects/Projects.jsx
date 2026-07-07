import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Save,
  Folder,
  CalendarDays,
  UserCircle,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

const emptyForm = {
  nome: "",
  descrizione: "",
  stato: "In corso",
  responsabile_id: "",
  data_inizio: "",
  deadline: "",
  data_chiusura: "",
};

const statiProgetto = [
  "In valutazione",
  "Pianificato",
  "In corso",
  "In attesa",
  "Completato",
  "Annullato",
];

function Projects() {
  const [progetti, setProgetti] = useState([]);
  const [utenti, setUtenti] = useState([]);
  const [tasks, setTasks] = useState([]);

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("tutti");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    const [projectsRes, usersRes, tasksRes] = await Promise.all([
      supabase
        .from("progetti")
        .select(`
          id,
          nome,
          descrizione,
          stato,
          responsabile_id,
          data_inizio,
          deadline,
          data_chiusura,
          created_at,
          updated_at,
          responsabile:utenti!progetti_responsabile_id_fkey(nome, email)
        `)
        .order("created_at", { ascending: false }),
      supabase
        .from("utenti")
        .select("id, nome, email, attivo")
        .eq("attivo", true)
        .order("nome"),
      supabase
        .from("tasks")
        .select(`
          id,
          progetto_id,
          deadline,
          stati_task(nome, chiusa)
        `),
    ]);

    if (projectsRes.error) {
      console.error("Errore caricamento progetti:", projectsRes.error);
      setProgetti([]);
    } else {
      setProgetti(projectsRes.data || []);
    }

    if (usersRes.error) {
      console.error("Errore caricamento utenti:", usersRes.error);
      setUtenti([]);
    } else {
      setUtenti(usersRes.data || []);
    }

    if (tasksRes.error) {
      console.error("Errore caricamento task progetto:", tasksRes.error);
      setTasks([]);
    } else {
      setTasks(tasksRes.data || []);
    }

    setLoading(false);
  }

  function openCreateModal() {
    setEditingProject(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEditModal(project) {
    setEditingProject(project);
    setForm({
      nome: project.nome || "",
      descrizione: project.descrizione || "",
      stato: project.stato || "In corso",
      responsabile_id: project.responsabile_id || "",
      data_inizio: project.data_inizio || "",
      deadline: project.deadline || "",
      data_chiusura: project.data_chiusura || "",
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingProject(null);
    setForm(emptyForm);
  }

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSave(e) {
    e.preventDefault();

    if (!form.nome.trim()) {
      alert("Inserisci il nome del progetto.");
      return;
    }

    setSaving(true);

    const payload = {
      nome: form.nome.trim(),
      descrizione: form.descrizione.trim() || null,
      stato: form.stato || "In corso",
      responsabile_id: form.responsabile_id || null,
      data_inizio: form.data_inizio || null,
      deadline: form.deadline || null,
      data_chiusura: form.data_chiusura || null,
    };

    const request = editingProject
      ? supabase.from("progetti").update(payload).eq("id", editingProject.id)
      : supabase.from("progetti").insert(payload);

    const { error } = await request;

    setSaving(false);

    if (error) {
      console.error("Errore salvataggio progetto:", error);
      alert("Errore durante il salvataggio del progetto.");
      return;
    }

    await loadData();
    closeModal();
  }

  async function deleteProject(project) {
    const projectTasks = tasks.filter((task) => task.progetto_id === project.id);

    if (projectTasks.length > 0) {
      alert(
        `Non puoi eliminare questo progetto perché ha ${projectTasks.length} task collegate.\n\nPuoi modificarlo o impostarlo come Annullato/Completato.`
      );
      return;
    }

    const confirmed = window.confirm(`Vuoi eliminare il progetto "${project.nome}"?`);

    if (!confirmed) return;

    const { error } = await supabase.from("progetti").delete().eq("id", project.id);

    if (error) {
      console.error("Errore eliminazione progetto:", error);
      alert("Errore durante l'eliminazione del progetto.");
      return;
    }

    await loadData();
  }

  function getProjectStats(projectId) {
    const projectTasks = tasks.filter((task) => task.progetto_id === projectId);
    const completed = projectTasks.filter((task) => task.stati_task?.chiusa).length;
    const open = projectTasks.length - completed;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdue = projectTasks.filter((task) => {
      if (!task.deadline || task.stati_task?.chiusa) return false;
      const deadline = new Date(task.deadline);
      deadline.setHours(0, 0, 0, 0);
      return deadline < today;
    }).length;

    const progress =
      projectTasks.length === 0
        ? 0
        : Math.round((completed / projectTasks.length) * 100);

    return {
      total: projectTasks.length,
      completed,
      open,
      overdue,
      progress,
    };
  }

  function formatDate(date) {
    if (!date) return "-";

    return new Date(date).toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function isProjectOverdue(project) {
    if (!project.deadline) return false;
    if (["Completato", "Annullato"].includes(project.stato)) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const deadline = new Date(project.deadline);
    deadline.setHours(0, 0, 0, 0);

    return deadline < today;
  }

  function getStatusClass(stato) {
    if (stato === "Completato") return "completed";
    if (stato === "Annullato") return "cancelled";
    if (stato === "In corso") return "active";
    if (stato === "In attesa") return "waiting";
    return "planned";
  }

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();

    return progetti.filter((project) => {
      const matchesSearch = !query
        ? true
        : `
          ${project.nome || ""}
          ${project.descrizione || ""}
          ${project.stato || ""}
          ${project.responsabile?.nome || ""}
        `
            .toLowerCase()
            .includes(query);

      const matchesStatus =
        statusFilter === "tutti" ? true : project.stato === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [progetti, search, statusFilter]);

  const counters = {
    totale: progetti.length,
    inCorso: progetti.filter((p) => p.stato === "In corso").length,
    completati: progetti.filter((p) => p.stato === "Completato").length,
    inRitardo: progetti.filter(isProjectOverdue).length,
  };

  return (
    <div className="projects-page">
      <div className="page-title-row">
        <div>
          <h1>Progetti</h1>
          <p>Gestione progetti, responsabili, scadenze e task collegate.</p>
        </div>

        <button className="primary-action" onClick={openCreateModal}>
          <Plus size={18} />
          Nuovo progetto
        </button>
      </div>

      <div className="projects-kpi-grid">
        <div className="project-kpi">
          <Folder size={22} />
          <div>
            <strong>{counters.totale}</strong>
            <span>Progetti totali</span>
          </div>
        </div>

        <div className="project-kpi">
          <CalendarDays size={22} />
          <div>
            <strong>{counters.inCorso}</strong>
            <span>In corso</span>
          </div>
        </div>

        <div className="project-kpi">
          <CheckCircle2 size={22} />
          <div>
            <strong>{counters.completati}</strong>
            <span>Completati</span>
          </div>
        </div>

        <div className="project-kpi danger">
          <AlertCircle size={22} />
          <div>
            <strong>{counters.inRitardo}</strong>
            <span>In ritardo</span>
          </div>
        </div>
      </div>

      <div className="projects-toolbar">
        <div className="projects-search">
          <Search size={18} />
          <input
            placeholder="Cerca progetto, responsabile o stato..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="projects-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="tutti">Tutti gli stati</option>
          {statiProgetto.map((stato) => (
            <option key={stato} value={stato}>
              {stato}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="panel">
          <p className="table-message">Caricamento progetti...</p>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="panel">
          <p className="table-message">Nessun progetto trovato. Crea il primo progetto.</p>
        </div>
      ) : (
        <div className="projects-grid">
          {filteredProjects.map((project) => {
            const stats = getProjectStats(project.id);
            const overdue = isProjectOverdue(project);

            return (
              <div className={`project-card ${overdue ? "overdue" : ""}`} key={project.id}>
                <div className="project-card-header">
                  <div>
                    <span className={`project-status ${getStatusClass(project.stato)}`}>
                      {project.stato || "In corso"}
                    </span>
                    <h3>{project.nome}</h3>
                  </div>

                  <div className="project-actions">
                    <button title="Modifica" onClick={() => openEditModal(project)}>
                      <Pencil size={16} />
                    </button>
                    <button
                      title="Elimina"
                      className="danger"
                      onClick={() => deleteProject(project)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <p className="project-description">
                  {project.descrizione || "Nessuna descrizione inserita."}
                </p>

                <div className="project-meta-grid">
                  <div>
                    <UserCircle size={17} />
                    <span>{project.responsabile?.nome || "Responsabile non assegnato"}</span>
                  </div>

                  <div className={overdue ? "danger" : ""}>
                    <CalendarDays size={17} />
                    <span>Scadenza: {formatDate(project.deadline)}</span>
                  </div>
                </div>

                <div className="project-progress-block">
                  <div className="progress-row">
                    <span>Avanzamento</span>
                    <strong>{stats.progress}%</strong>
                  </div>

                  <div className="progress-bar">
                    <div style={{ width: `${stats.progress}%` }} />
                  </div>
                </div>

                <div className="project-task-stats">
                  <div>
                    <strong>{stats.total}</strong>
                    <span>Task</span>
                  </div>
                  <div>
                    <strong>{stats.open}</strong>
                    <span>Aperte</span>
                  </div>
                  <div>
                    <strong>{stats.completed}</strong>
                    <span>Chiuse</span>
                  </div>
                  <div className={stats.overdue ? "danger" : ""}>
                    <strong>{stats.overdue}</strong>
                    <span>Scadute</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <div className="modal-backdrop">
          <div className="project-modal">
            <div className="modal-header">
              <div>
                <h2>{editingProject ? "Modifica progetto" : "Nuovo progetto"}</h2>
                <p>Definisci nome, stato, responsabile e scadenze del progetto.</p>
              </div>

              <button className="modal-close" onClick={closeModal} type="button">
                <X size={22} />
              </button>
            </div>

            <form className="project-form" onSubmit={handleSave}>
              <div className="form-group full">
                <label>Nome progetto *</label>
                <input
                  value={form.nome}
                  onChange={(e) => updateForm("nome", e.target.value)}
                  placeholder="Es. Nuova linea capelli"
                  autoFocus
                />
              </div>

              <div className="form-group full">
                <label>Descrizione</label>
                <textarea
                  value={form.descrizione}
                  onChange={(e) => updateForm("descrizione", e.target.value)}
                  placeholder="Descrivi obiettivi, contesto e note del progetto..."
                />
              </div>

              <div className="form-group">
                <label>Stato</label>
                <select value={form.stato} onChange={(e) => updateForm("stato", e.target.value)}>
                  {statiProgetto.map((stato) => (
                    <option key={stato} value={stato}>
                      {stato}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Responsabile</label>
                <select
                  value={form.responsabile_id}
                  onChange={(e) => updateForm("responsabile_id", e.target.value)}
                >
                  <option value="">Non assegnato</option>
                  {utenti.map((utente) => (
                    <option key={utente.id} value={utente.id}>
                      {utente.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Data inizio</label>
                <input
                  type="date"
                  value={form.data_inizio}
                  onChange={(e) => updateForm("data_inizio", e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Deadline</label>
                <input
                  type="date"
                  value={form.deadline}
                  onChange={(e) => updateForm("deadline", e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Data chiusura</label>
                <input
                  type="date"
                  value={form.data_chiusura}
                  onChange={(e) => updateForm("data_chiusura", e.target.value)}
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="secondary-action" onClick={closeModal}>
                  Annulla
                </button>

                <button type="submit" className="primary-action" disabled={saving}>
                  <Save size={18} />
                  {saving ? "Salvataggio..." : "Salva progetto"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Projects;

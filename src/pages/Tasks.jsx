import { useEffect, useState } from "react";
import { Plus, Search, CalendarDays, AlertCircle } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import TaskModal from "../components/TaskModal";

function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    setLoading(true);

    const { data, error } = await supabase
      .from("tasks")
      .select(`
        id,
        titolo,
        descrizione,
        deadline,
        data_apertura,
        data_completamento,
        categorie_task(nome, colore),
        stati_task(nome, colore, chiusa),
        prodotti(nome),
        progetti(nome),
        richiedente:utenti!tasks_richiedente_id_fkey(nome),
        assegnato:utenti!tasks_assegnato_a_id_fkey(nome)
      `)
      .order("deadline", { ascending: true, nullsFirst: false });

    if (error) {
      console.error("Errore caricamento task:", error);
    } else {
      setTasks(data || []);
    }

    setLoading(false);
  }

  function isOverdue(task) {
    if (!task.deadline) return false;
    if (task.stati_task?.chiusa) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const deadline = new Date(task.deadline);
    deadline.setHours(0, 0, 0, 0);

    return deadline < today;
  }

  function formatDate(date) {
    if (!date) return "Senza deadline";

    return new Date(date).toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  const filteredTasks = tasks.filter((task) => {
    const text = `
      ${task.titolo || ""}
      ${task.descrizione || ""}
      ${task.prodotti?.nome || ""}
      ${task.progetti?.nome || ""}
      ${task.assegnato?.nome || ""}
      ${task.categorie_task?.nome || ""}
      ${task.stati_task?.nome || ""}
    `.toLowerCase();

    return text.includes(search.toLowerCase());
  });

  return (
    <div className="tasks-page">
      <div className="page-title-row">
        <div>
          <h1>Task</h1>
          <p>Gestione attività, assegnazioni e deadline.</p>
        </div>

        <button className="primary-action" onClick={() => setModalOpen(true)}>
          <Plus size={18} />
          Nuova task
        </button>
      </div>

      <div className="task-toolbar">
        <div className="task-search">
          <Search size={18} />
          <input
            placeholder="Cerca task, prodotto o progetto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <button className="filter-chip active">Tutte</button>
        <button className="filter-chip">Oggi</button>
        <button className="filter-chip">Scadute</button>
        <button className="filter-chip">Senza deadline</button>
      </div>

      <div className="panel tasks-panel">
        {loading ? (
          <p className="table-message">Caricamento task...</p>
        ) : filteredTasks.length === 0 ? (
          <p className="table-message">Nessuna task trovata.</p>
        ) : (
          <div className="tasks-table">
            <div className="tasks-table-head">
              <span>Task</span>
              <span>Categoria</span>
              <span>Stato</span>
              <span>Progetto</span>
              <span>Prodotto</span>
              <span>Assegnato a</span>
              <span>Deadline</span>
            </div>

            {filteredTasks.map((task) => {
              const overdue = isOverdue(task);

              return (
                <div
                  className={`tasks-table-row ${overdue ? "overdue" : ""}`}
                  key={task.id}
                >
                  <div className="task-main-cell">
                    <strong>{task.titolo}</strong>
                    <small>{task.descrizione || "Nessuna descrizione"}</small>
                  </div>

                  <span
                    className="status-badge"
                    style={{
                      backgroundColor: `${task.categorie_task?.colore || "#64748b"}20`,
                      color: task.categorie_task?.colore || "#64748b",
                    }}
                  >
                    {task.categorie_task?.nome || "-"}
                  </span>

                  <span
                    className="status-badge"
                    style={{
                      backgroundColor: `${task.stati_task?.colore || "#64748b"}20`,
                      color: task.stati_task?.colore || "#64748b",
                    }}
                  >
                    {task.stati_task?.nome || "-"}
                  </span>

                  <span>{task.progetti?.nome || "-"}</span>
                  <span>{task.prodotti?.nome || "-"}</span>
                  <span>{task.assegnato?.nome || "-"}</span>

                  <span className={`deadline-cell ${overdue ? "danger" : ""}`}>
                    {overdue ? <AlertCircle size={16} /> : <CalendarDays size={16} />}
                    {formatDate(task.deadline)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <TaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={loadTasks}
      />
    </div>
  );
}

export default Tasks;

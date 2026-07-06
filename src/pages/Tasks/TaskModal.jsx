import { useEffect, useMemo, useState } from "react";
import { X, History, MessageCircle, Paperclip, CheckSquare } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

function TaskModal({ open, mode = "create", task = null, onClose, onSaved }) {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState("dettagli");

  const [titolo, setTitolo] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [statoId, setStatoId] = useState("");
  const [progettoId, setProgettoId] = useState("");
  const [prodottoId, setProdottoId] = useState("");
  const [assegnatoAId, setAssegnatoAId] = useState("");
  const [deadline, setDeadline] = useState("");

  const [categorie, setCategorie] = useState([]);
  const [stati, setStati] = useState([]);
  const [progetti, setProgetti] = useState([]);
  const [prodotti, setProdotti] = useState([]);
  const [utenti, setUtenti] = useState([]);
  const [attivita, setAttivita] = useState([]);
  const [saving, setSaving] = useState(false);

  const isEditing = mode === "edit" && task && task.id;

  const optionsMaps = useMemo(() => {
    return {
      categorie: Object.fromEntries(categorie.map((item) => [item.id, item.nome])),
      stati: Object.fromEntries(stati.map((item) => [item.id, item.nome])),
      progetti: Object.fromEntries(progetti.map((item) => [item.id, item.nome])),
      prodotti: Object.fromEntries(prodotti.map((item) => [item.id, item.nome])),
      utenti: Object.fromEntries(utenti.map((item) => [item.id, item.nome])),
    };
  }, [categorie, stati, progetti, prodotti, utenti]);

  useEffect(() => {
    if (!open) return;

    async function initialize() {
      setActiveTab("dettagli");

      const options = await loadOptions();

      if (isEditing) {
        setTitolo(task.titolo || "");
        setDescrizione(task.descrizione || "");
        setCategoriaId(task.categoria_id || "");
        setStatoId(task.stato_id || "");
        setProgettoId(task.progetto_id || "");
        setProdottoId(task.prodotto_id || "");
        setAssegnatoAId(task.assegnato_a_id || "");
        setDeadline(task.deadline || "");
        await loadAttivita(task.id);
      } else {
        setTitolo("");
        setDescrizione("");
        setCategoriaId("");
        setProgettoId("");
        setProdottoId("");
        setAssegnatoAId("");
        setDeadline("");
        setAttivita([]);

        const nuova = options.stati.find((s) => s.nome === "Nuova");
        setStatoId(nuova?.id || options.stati[0]?.id || "");
      }
    }

    initialize();
  }, [open, mode, task?.id]);

  async function loadOptions() {
    const [categorieRes, statiRes, progettiRes, prodottiRes, utentiRes] =
      await Promise.all([
        supabase.from("categorie_task").select("*").eq("attiva", true).order("ordine"),
        supabase.from("stati_task").select("*").eq("attiva", true).order("ordine"),
        supabase.from("progetti").select("*").order("nome"),
        supabase.from("prodotti").select("*").order("nome"),
        supabase.from("utenti").select("*").eq("attivo", true).order("nome"),
      ]);

    if (categorieRes.error) console.error("Errore categorie:", categorieRes.error);
    if (statiRes.error) console.error("Errore stati:", statiRes.error);
    if (progettiRes.error) console.error("Errore progetti:", progettiRes.error);
    if (prodottiRes.error) console.error("Errore prodotti:", prodottiRes.error);
    if (utentiRes.error) console.error("Errore utenti:", utentiRes.error);

    const options = {
      categorie: categorieRes.data || [],
      stati: statiRes.data || [],
      progetti: progettiRes.data || [],
      prodotti: prodottiRes.data || [],
      utenti: utentiRes.data || [],
    };

    setCategorie(options.categorie);
    setStati(options.stati);
    setProgetti(options.progetti);
    setProdotti(options.prodotti);
    setUtenti(options.utenti);

    return options;
  }

  async function loadAttivita(taskId) {
    const { data, error } = await supabase
      .from("attivita_task")
      .select(`
        id,
        data_ora,
        tipo,
        campo,
        valore_precedente,
        valore_nuovo,
        note,
        utenti(nome)
      `)
      .eq("task_id", taskId)
      .order("data_ora", { ascending: false });

    if (error) {
      console.error("Errore caricamento attività task:", error);
      setAttivita([]);
      return;
    }

    setAttivita(data || []);
  }

  function resetForm() {
    setTitolo("");
    setDescrizione("");
    setCategoriaId("");
    setStatoId("");
    setProgettoId("");
    setProdottoId("");
    setAssegnatoAId("");
    setDeadline("");
    setAttivita([]);
    setActiveTab("dettagli");
  }

  function getLabel(mapName, value) {
    if (!value) return "";
    return optionsMaps[mapName]?.[value] || value;
  }

  function normalize(value) {
    return value === undefined || value === null ? "" : String(value);
  }

  function getChangeType(field) {
    if (field === "stato") return "CAMBIO STATO";
    if (field === "assegnato a") return "CAMBIO ASSEGNATO";
    if (field === "deadline") return "CAMBIO DEADLINE";
    return "MODIFICA";
  }

  function buildChanges(payload) {
    if (!isEditing) {
      return [
        {
          tipo: "CREAZIONE",
          campo: "task",
          valore_precedente: null,
          valore_nuovo: payload.titolo,
          note: "Task creata",
        },
      ];
    }

    const fields = [
      {
        campo: "titolo",
        oldValue: task.titolo,
        newValue: payload.titolo,
      },
      {
        campo: "descrizione",
        oldValue: task.descrizione,
        newValue: payload.descrizione,
      },
      {
        campo: "categoria",
        oldValue: getLabel("categorie", task.categoria_id),
        newValue: getLabel("categorie", payload.categoria_id),
      },
      {
        campo: "stato",
        oldValue: getLabel("stati", task.stato_id),
        newValue: getLabel("stati", payload.stato_id),
      },
      {
        campo: "progetto",
        oldValue: getLabel("progetti", task.progetto_id),
        newValue: getLabel("progetti", payload.progetto_id),
      },
      {
        campo: "prodotto",
        oldValue: getLabel("prodotti", task.prodotto_id),
        newValue: getLabel("prodotti", payload.prodotto_id),
      },
      {
        campo: "assegnato a",
        oldValue: getLabel("utenti", task.assegnato_a_id),
        newValue: getLabel("utenti", payload.assegnato_a_id),
      },
      {
        campo: "deadline",
        oldValue: task.deadline,
        newValue: payload.deadline,
      },
    ];

    return fields
      .filter((field) => normalize(field.oldValue) !== normalize(field.newValue))
      .map((field) => ({
        tipo: getChangeType(field.campo),
        campo: field.campo,
        valore_precedente: normalize(field.oldValue) || null,
        valore_nuovo: normalize(field.newValue) || null,
        note: `Campo "${field.campo}" modificato`,
      }));
  }

  async function insertActivityRows(taskId, userId, changes) {
    if (!changes.length) return;

    const rows = changes.map((change) => ({
      task_id: taskId,
      utente_id: userId || null,
      tipo: change.tipo,
      campo: change.campo,
      valore_precedente: change.valore_precedente,
      valore_nuovo: change.valore_nuovo,
      note: change.note,
    }));

    const { error } = await supabase.from("attivita_task").insert(rows);

    if (error) {
      console.error("Errore inserimento attività:", error);
    }
  }

  async function handleSave(e) {
    e.preventDefault();

    if (!titolo.trim()) {
      alert("Inserisci il titolo della task.");
      return;
    }

    setSaving(true);

    const basePayload = {
      titolo: titolo.trim(),
      descrizione: descrizione.trim() || null,
      categoria_id: categoriaId || null,
      stato_id: statoId || null,
      progetto_id: progettoId || null,
      prodotto_id: prodottoId || null,
      assegnato_a_id: assegnatoAId || null,
      deadline: deadline || null,
    };

    const payload = isEditing
      ? {
          ...basePayload,
          modificato_da_id: profile?.id || null,
        }
      : {
          ...basePayload,
          creato_da_id: profile?.id || null,
          richiedente_id: profile?.id || null,
          modificato_da_id: null,
        };

    const changes = buildChanges(payload);
    const userIdForActivity = profile?.id || null;

    if (isEditing && changes.length === 0) {
      setSaving(false);
      onClose();
      return;
    }

    if (isEditing) {
      const { error } = await supabase.from("tasks").update(payload).eq("id", task.id);

      if (error) {
        setSaving(false);
        console.error("Errore salvataggio task:", error);
        alert("Errore durante il salvataggio della task.");
        return;
      }

      await insertActivityRows(task.id, userIdForActivity, changes);
    } else {
      const { data, error } = await supabase
        .from("tasks")
        .insert(payload)
        .select("id")
        .single();

      if (error) {
        setSaving(false);
        console.error("Errore salvataggio task:", error);
        alert("Errore durante il salvataggio della task.");
        return;
      }

      await insertActivityRows(data.id, userIdForActivity, changes);
    }

    setSaving(false);
    resetForm();
    onSaved();
    onClose();
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function formatDateTime(date) {
    if (!date) return "-";

    return new Date(date).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div className="task-modal task-modal-wide">
        <div className="modal-header">
          <div>
            <h2>{isEditing ? "Modifica task" : "Nuova task"}</h2>
            <p>
              {isEditing
                ? "Gestisci dettagli, attività, commenti, allegati e checklist."
                : "Crea una nuova attività. Creatore e modifiche saranno registrati automaticamente."}
            </p>
          </div>

          <button className="modal-close" onClick={handleClose} type="button">
            <X size={22} />
          </button>
        </div>

        <div className="task-tabs">
          <button
            className={activeTab === "dettagli" ? "active" : ""}
            onClick={() => setActiveTab("dettagli")}
            type="button"
          >
            Dettagli
          </button>

          <button
            className={activeTab === "attivita" ? "active" : ""}
            onClick={() => setActiveTab("attivita")}
            type="button"
            disabled={!isEditing}
          >
            <History size={16} />
            Attività
          </button>

          <button
            className={activeTab === "commenti" ? "active" : ""}
            onClick={() => setActiveTab("commenti")}
            type="button"
            disabled={!isEditing}
          >
            <MessageCircle size={16} />
            Commenti
          </button>

          <button
            className={activeTab === "allegati" ? "active" : ""}
            onClick={() => setActiveTab("allegati")}
            type="button"
            disabled={!isEditing}
          >
            <Paperclip size={16} />
            Allegati
          </button>

          <button
            className={activeTab === "checklist" ? "active" : ""}
            onClick={() => setActiveTab("checklist")}
            type="button"
            disabled={!isEditing}
          >
            <CheckSquare size={16} />
            Checklist
          </button>
        </div>

        {activeTab === "dettagli" && (
          <form onSubmit={handleSave} className="task-form">
            <div className="form-group full">
              <label>Titolo *</label>
              <input
                value={titolo}
                onChange={(e) => setTitolo(e.target.value)}
                placeholder="Es. Revisione formula shampoo"
                autoFocus
              />
            </div>

            <div className="form-group full">
              <label>Descrizione</label>
              <textarea
                value={descrizione}
                onChange={(e) => setDescrizione(e.target.value)}
                placeholder="Descrivi l'attività..."
              />
            </div>

            <div className="form-group">
              <label>Categoria</label>
              <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                <option value="">Seleziona categoria</option>
                {categorie.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Stato</label>
              <select value={statoId} onChange={(e) => setStatoId(e.target.value)}>
                <option value="">Seleziona stato</option>
                {stati.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Progetto</label>
              <select value={progettoId} onChange={(e) => setProgettoId(e.target.value)}>
                <option value="">Nessun progetto</option>
                {progetti.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Prodotto</label>
              <select value={prodottoId} onChange={(e) => setProdottoId(e.target.value)}>
                <option value="">Nessun prodotto</option>
                {prodotti.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Assegnato a</label>
              <select value={assegnatoAId} onChange={(e) => setAssegnatoAId(e.target.value)}>
                <option value="">Non assegnata</option>
                {utenti.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Deadline</label>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>

            <div className="modal-actions">
              <button type="button" className="secondary-action" onClick={handleClose}>
                Annulla
              </button>

              <button type="submit" className="primary-action" disabled={saving}>
                {saving ? "Salvataggio..." : isEditing ? "Salva modifiche" : "Salva task"}
              </button>
            </div>
          </form>
        )}

        {activeTab === "attivita" && (
          <div className="task-tab-content">
            <div className="tab-title-row">
              <div>
                <h3>Storico attività task</h3>
                <p>Registro completo delle modifiche effettuate sulla task.</p>
              </div>
              <button type="button" className="secondary-action" onClick={() => loadAttivita(task.id)}>
                Aggiorna storico
              </button>
            </div>

            {attivita.length === 0 ? (
              <p className="empty-state">Nessuna attività registrata.</p>
            ) : (
              <div className="activity-table">
                <div className="activity-table-head">
                  <span>Data e ora</span>
                  <span>Utente</span>
                  <span>Azione</span>
                  <span>Campo</span>
                  <span>Da</span>
                  <span>A</span>
                  <span>Note</span>
                </div>

                {attivita.map((item) => (
                  <div className="activity-table-row" key={item.id}>
                    <span>{formatDateTime(item.data_ora)}</span>
                    <span>{item.utenti?.nome || "-"}</span>
                    <span className="activity-type">{item.tipo}</span>
                    <span>{item.campo || "-"}</span>
                    <span className="old-value">{item.valore_precedente || "—"}</span>
                    <span className="new-value">{item.valore_nuovo || "—"}</span>
                    <span>{item.note || "-"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "commenti" && (
          <div className="task-tab-content">
            <h3>Commenti</h3>
            <p className="empty-state">
              Modulo commenti pronto per il prossimo step. Qui inseriremo la conversazione della task.
            </p>
          </div>
        )}

        {activeTab === "allegati" && (
          <div className="task-tab-content">
            <h3>Allegati</h3>
            <p className="empty-state">
              Modulo allegati pronto per il prossimo step. Qui caricheremo PDF, immagini, Excel e documenti.
            </p>
          </div>
        )}

        {activeTab === "checklist" && (
          <div className="task-tab-content">
            <h3>Checklist</h3>
            <p className="empty-state">
              Modulo checklist pronto per il prossimo step. Qui inseriremo sotto-attività con spunta.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default TaskModal;

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

function TaskModal({ open, mode, task, onClose, onSaved }) {
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
  const [saving, setSaving] = useState(false);

  const isEditing = mode === "edit" && Boolean(task?.id);

  useEffect(() => {
    if (!open) return;

    async function initializeModal() {
      const options = await loadOptions();

      if (mode === "edit" && task?.id) {
        fillForm(task);
      } else {
        resetForm();
        const nuova = options.stati.find((s) => s.nome === "Nuova");
        setStatoId(nuova?.id || options.stati[0]?.id || "");
      }
    }

    initializeModal();
  }, [open, mode, task]);

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

    const categorieData = categorieRes.data || [];
    const statiData = statiRes.data || [];
    const progettiData = progettiRes.data || [];
    const prodottiData = prodottiRes.data || [];
    const utentiData = utentiRes.data || [];

    setCategorie(categorieData);
    setStati(statiData);
    setProgetti(progettiData);
    setProdotti(prodottiData);
    setUtenti(utentiData);

    return {
      categorie: categorieData,
      stati: statiData,
      progetti: progettiData,
      prodotti: prodottiData,
      utenti: utentiData,
    };
  }

  function fillForm(taskToEdit) {
    setTitolo(taskToEdit.titolo || "");
    setDescrizione(taskToEdit.descrizione || "");
    setCategoriaId(taskToEdit.categoria_id || "");
    setStatoId(taskToEdit.stato_id || "");
    setProgettoId(taskToEdit.progetto_id || "");
    setProdottoId(taskToEdit.prodotto_id || "");
    setAssegnatoAId(taskToEdit.assegnato_a_id || "");
    setDeadline(taskToEdit.deadline || "");
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
  }

  async function handleSave(e) {
    e.preventDefault();

    if (!titolo.trim()) {
      alert("Inserisci il titolo della task.");
      return;
    }

    setSaving(true);

    const payload = {
      titolo: titolo.trim(),
      descrizione: descrizione.trim() || null,
      categoria_id: categoriaId || null,
      stato_id: statoId || null,
      progetto_id: progettoId || null,
      prodotto_id: prodottoId || null,
      assegnato_a_id: assegnatoAId || null,
      deadline: deadline || null,
      updated_at: new Date().toISOString(),
    };

    const request = isEditing
      ? supabase.from("tasks").update(payload).eq("id", task.id)
      : supabase.from("tasks").insert(payload);

    const { error } = await request;

    setSaving(false);

    if (error) {
      console.error("Errore salvataggio task:", error);
      alert("Errore durante il salvataggio della task.");
      return;
    }

    resetForm();
    onSaved();
    onClose();
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div className="task-modal">
        <div className="modal-header">
          <div>
            <h2>{isEditing ? "Modifica task" : "Nuova task"}</h2>
            <p>
              {isEditing
                ? "Aggiorna attività, assegnazione, stato e deadline."
                : "Crea una nuova attività con assegnazione e deadline."}
            </p>
          </div>

          <button className="modal-close" onClick={handleClose} type="button">
            <X size={22} />
          </button>
        </div>

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
      </div>
    </div>
  );
}

export default TaskModal;

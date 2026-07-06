import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

function TaskModal({ open, onClose, onSaved }) {
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

  useEffect(() => {
    if (open) {
      loadOptions();
    }
  }, [open]);

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

    setCategorie(categorieRes.data || []);
    setStati(statiRes.data || []);
    setProgetti(progettiRes.data || []);
    setProdotti(prodottiRes.data || []);
    setUtenti(utentiRes.data || []);

    const nuova = (statiRes.data || []).find((s) => s.nome === "Nuova");
    setStatoId((current) => current || nuova?.id || statiRes.data?.[0]?.id || "");
  }

  function resetForm() {
    setTitolo("");
    setDescrizione("");
    setCategoriaId("");
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

    const { error } = await supabase.from("tasks").insert({
      titolo: titolo.trim(),
      descrizione: descrizione.trim() || null,
      categoria_id: categoriaId || null,
      stato_id: statoId || null,
      progetto_id: progettoId || null,
      prodotto_id: prodottoId || null,
      assegnato_a_id: assegnatoAId || null,
      deadline: deadline || null,
    });

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
            <h2>Nuova task</h2>
            <p>Crea una nuova attività con assegnazione e deadline.</p>
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
              {saving ? "Salvataggio..." : "Salva task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TaskModal;

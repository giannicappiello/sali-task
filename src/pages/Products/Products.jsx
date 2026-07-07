import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Package,
  CheckCircle2,
  XCircle,
  Pencil,
  Trash2,
  Plus,
  X,
  Save,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

const emptyForm = {
  nome: "",
  codice: "",
  brand: "",
  categoria: "",
  attivo: true,
  note: "",
};

function Products() {
  const navigate = useNavigate();

  const [prodotti, setProdotti] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("tutti");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);

    const { data, error } = await supabase
      .from("prodotti")
      .select(`
        id,
        nome,
        codice,
        brand,
        categoria,
        attivo,
        note,
        created_at,
        updated_at
      `)
      .order("nome", { ascending: true })
      .range(0, 49999);

    if (error) {
      console.error("Errore caricamento prodotti:", error);
      setProdotti([]);
    } else {
      setProdotti(data || []);
    }

    setLoading(false);
  }

  function openCreateModal() {
    setEditingProduct(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEditModal(product) {
    setEditingProduct(product);
    setForm({
      nome: product.nome || "",
      codice: product.codice || "",
      brand: product.brand || "",
      categoria: product.categoria || "",
      attivo: product.attivo !== false,
      note: product.note || "",
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingProduct(null);
    setForm(emptyForm);
  }

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function openProductTasks(product) {
    navigate(`/tasks?product=${product.id}`);
  }

  async function handleSave(e) {
    e.preventDefault();

    if (!form.nome.trim()) {
      alert("Inserisci il nome del prodotto.");
      return;
    }

    setSaving(true);

    const payload = {
      nome: form.nome.trim(),
      codice: form.codice.trim() || null,
      brand: form.brand.trim() || null,
      categoria: form.categoria.trim() || null,
      attivo: form.attivo,
      note: form.note.trim() || null,
    };

    const request = editingProduct
      ? supabase.from("prodotti").update(payload).eq("id", editingProduct.id)
      : supabase.from("prodotti").insert(payload);

    const { error } = await request;

    setSaving(false);

    if (error) {
      console.error("Errore salvataggio prodotto:", error);
      alert("Errore durante il salvataggio del prodotto. Verifica che il codice non sia già presente.");
      return;
    }

    await loadProducts();
    closeModal();
  }

  async function toggleActive(product) {
    const { error } = await supabase
      .from("prodotti")
      .update({ attivo: !product.attivo })
      .eq("id", product.id);

    if (error) {
      console.error("Errore aggiornamento stato prodotto:", error);
      alert("Errore durante l'aggiornamento dello stato prodotto.");
      return;
    }

    await loadProducts();
  }

  async function deleteProduct(product) {
    const confirmed = window.confirm(
      `Vuoi eliminare il prodotto "${product.nome}"?\n\nSe è già collegato a task o progetti, l'eliminazione potrebbe non essere consentita.`
    );

    if (!confirmed) return;

    const { error } = await supabase.from("prodotti").delete().eq("id", product.id);

    if (error) {
      console.error("Errore eliminazione prodotto:", error);
      alert("Impossibile eliminare il prodotto. Puoi disattivarlo invece di eliminarlo.");
      return;
    }

    await loadProducts();
  }

  function formatDate(date) {
    if (!date) return "-";

    return new Date(date).toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return prodotti.filter((product) => {
      const matchesSearch = !query
        ? true
        : `
          ${product.nome || ""}
          ${product.codice || ""}
          ${product.brand || ""}
          ${product.categoria || ""}
          ${product.note || ""}
        `
            .toLowerCase()
            .includes(query);

      const matchesStatus =
        statusFilter === "tutti"
          ? true
          : statusFilter === "attivi"
            ? product.attivo !== false
            : product.attivo === false;

      return matchesSearch && matchesStatus;
    });
  }, [prodotti, search, statusFilter]);

  const counters = {
    totale: prodotti.length,
    attivi: prodotti.filter((p) => p.attivo !== false).length,
    disattivi: prodotti.filter((p) => p.attivo === false).length,
  };

  return (
    <div className="products-page">
      <div className="page-title-row">
        <div>
          <h1>Prodotti</h1>
          <p>Elenco prodotti importati e gestiti nel workspace.</p>
        </div>

        <button className="primary-action" onClick={openCreateModal}>
          <Plus size={18} />
          Nuovo prodotto
        </button>
      </div>

      <div className="product-kpi-grid">
        <div className="product-kpi">
          <Package size={22} />
          <div>
            <strong>{counters.totale}</strong>
            <span>Prodotti totali</span>
          </div>
        </div>

        <div className="product-kpi">
          <CheckCircle2 size={22} />
          <div>
            <strong>{counters.attivi}</strong>
            <span>Attivi</span>
          </div>
        </div>

        <div className="product-kpi">
          <XCircle size={22} />
          <div>
            <strong>{counters.disattivi}</strong>
            <span>Disattivi</span>
          </div>
        </div>
      </div>

      <div className="products-toolbar">
        <div className="products-search">
          <Search size={18} />
          <input
            placeholder="Cerca per nome, codice, brand o categoria..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="products-filters">
          <button
            className={statusFilter === "tutti" ? "active" : ""}
            onClick={() => setStatusFilter("tutti")}
          >
            Tutti
          </button>
          <button
            className={statusFilter === "attivi" ? "active" : ""}
            onClick={() => setStatusFilter("attivi")}
          >
            Attivi
          </button>
          <button
            className={statusFilter === "disattivi" ? "active" : ""}
            onClick={() => setStatusFilter("disattivi")}
          >
            Disattivi
          </button>
        </div>
      </div>

      <div className="panel products-panel">
        {loading ? (
          <p className="table-message">Caricamento prodotti...</p>
        ) : filteredProducts.length === 0 ? (
          <p className="table-message">Nessun prodotto trovato.</p>
        ) : (
          <div className="products-table">
            <div className="products-table-head">
              <span>Prodotto</span>
              <span>Codice</span>
              <span>Brand</span>
              <span>Categoria</span>
              <span>Stato</span>
              <span>Aggiornato</span>
              <span>Azioni</span>
            </div>

            {filteredProducts.map((product) => (
              <div className="products-table-row" key={product.id}>
                <button
                  type="button"
                  className="product-main-cell product-click-cell"
                  onClick={() => openProductTasks(product)}
                  title="Apri task collegate a questo prodotto"
                >
                  <strong>{product.nome}</strong>
                  <small>{product.note || "Clicca per vedere le task collegate"}</small>
                </button>

                <span className="product-code">{product.codice || "-"}</span>
                <span>{product.brand || "-"}</span>
                <span>{product.categoria || "-"}</span>

                <span className={`product-status ${product.attivo === false ? "inactive" : "active"}`}>
                  {product.attivo === false ? "Disattivo" : "Attivo"}
                </span>

                <span>{formatDate(product.updated_at || product.created_at)}</span>

                <div className="product-actions">
                  <button title="Modifica" onClick={() => openEditModal(product)}>
                    <Pencil size={16} />
                  </button>

                  <button
                    title={product.attivo === false ? "Riattiva" : "Disattiva"}
                    onClick={() => toggleActive(product)}
                  >
                    {product.attivo === false ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  </button>

                  <button
                    title="Elimina"
                    className="danger"
                    onClick={() => deleteProduct(product)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="modal-backdrop">
          <div className="product-modal">
            <div className="modal-header">
              <div>
                <h2>{editingProduct ? "Modifica prodotto" : "Nuovo prodotto"}</h2>
                <p>Gestisci codice, nome, brand, categoria, stato e note interne.</p>
              </div>

              <button className="modal-close" onClick={closeModal} type="button">
                <X size={22} />
              </button>
            </div>

            <form className="product-form" onSubmit={handleSave}>
              <div className="form-group full">
                <label>Nome *</label>
                <input
                  value={form.nome}
                  onChange={(e) => updateForm("nome", e.target.value)}
                  placeholder="Nome prodotto"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Codice</label>
                <input
                  value={form.codice}
                  onChange={(e) => updateForm("codice", e.target.value)}
                  placeholder="Codice prodotto"
                />
              </div>

              <div className="form-group">
                <label>Brand</label>
                <input
                  value={form.brand}
                  onChange={(e) => updateForm("brand", e.target.value)}
                  placeholder="Brand"
                />
              </div>

              <div className="form-group">
                <label>Categoria</label>
                <input
                  value={form.categoria}
                  onChange={(e) => updateForm("categoria", e.target.value)}
                  placeholder="Categoria"
                />
              </div>

              <div className="form-group">
                <label>Stato</label>
                <select
                  value={form.attivo ? "true" : "false"}
                  onChange={(e) => updateForm("attivo", e.target.value === "true")}
                >
                  <option value="true">Attivo</option>
                  <option value="false">Disattivo</option>
                </select>
              </div>

              <div className="form-group full">
                <label>Note interne</label>
                <textarea
                  value={form.note}
                  onChange={(e) => updateForm("note", e.target.value)}
                  placeholder="Note interne sul prodotto..."
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="secondary-action" onClick={closeModal}>
                  Annulla
                </button>

                <button type="submit" className="primary-action" disabled={saving}>
                  <Save size={18} />
                  {saving ? "Salvataggio..." : "Salva prodotto"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Products;

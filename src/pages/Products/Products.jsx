import { useEffect, useMemo, useState } from "react";
import { FileText, Package, RefreshCw, Search, Megaphone, Factory } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

const BATCH_SIZE = 8;

function getProductDisplayName(product) {
  const raw = product?.json_mexal;
  const description = String(raw?.descrizione || "").trimEnd();
  const additionalDescription = String(raw?.descrizione_agg || "").trimStart();
  const mexalName = `${description}${additionalDescription}`.replace(/\s+/g, " ").trim();
  return mexalName || String(product?.nome || "").replace(/\s+/g, " ").trim();
}

const SECTIONS = [
  {
    id: "IT",
    title: "Prodotti",
    description: "Articoli di prodotto con codice IT*.",
    icon: Package,
  },
  {
    id: "MKT",
    title: "Materiali Marketing",
    description: "Materiali commerciali e promozionali con codice MKT*.",
    icon: Megaphone,
  },
  {
    id: "IMP",
    title: "Impianti",
    description: "Impianti e attrezzature con codice IMP*.",
    icon: Factory,
  },
];

function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
  });
}

function getProductCode(product) {
  return String(product?.codice_mexal || product?.codice || "")
    .trim()
    .toUpperCase();
}

export default function Products() {
  const { profile, isAdminUser } = useAuth();
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState("IT");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [canSyncMexal, setCanSyncMexal] = useState(false);
  const [syncingReal, setSyncingReal] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    loadSyncPermission();
  }, [profile?.id, isAdminUser]);

  async function loadProducts() {
    setLoading(true);

    const { data, error } = await supabase
      .from("prodotti")
      .select("*")
      .eq("attivo_mexal", true)
      .eq("mostra_in_app", true)
      .order("nome")
      .limit(5000);

    if (error) console.error("Prodotti Mexal:", error.message);

    const rows = data || [];
    setProducts(rows);
    setLoading(false);
  }

  async function loadSyncPermission() {
    if (!profile?.id) {
      setCanSyncMexal(false);
      return;
    }

    if (isAdminUser) {
      setCanSyncMexal(true);
      return;
    }

    const { data, error } = await supabase
      .from("integrazioni_utenti")
      .select("enabled,ruolo_ordini")
      .eq("utente_id", profile.id)
      .eq("modulo", "gestione_ordini")
      .maybeSingle();

    if (error) {
      console.error("Errore autorizzazione sincronizzazione Mexal:", error.message);
      setCanSyncMexal(false);
      return;
    }

    setCanSyncMexal(
      data?.enabled === true && data?.ruolo_ordini === "backoffice"
    );
  }

  async function callMexalApi(body) {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      throw new Error("Sessione scaduta. Effettua nuovamente l'accesso.");
    }

    const response = await fetch("/api/mexal/sync-products", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let result;

    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      result = { error: text || "Risposta API non valida." };
    }

    if (!response.ok) {
      throw new Error(result.error || `Errore API (${response.status}).`);
    }

    return result;
  }

  async function synchronizeMexal() {
    if (!canSyncMexal) return;

    if (
      !window.confirm(
        "Avviare la sincronizzazione del catalogo con Mexal?\n\n" +
          "Sali-task aggiornerà esclusivamente la propria copia in sola lettura."
      )
    ) {
      return;
    }

    setSyncingReal(true);
    setSyncResult(null);

    let offset = 0;
    const totals = {
      inseriti: 0,
      aggiornati: 0,
      immagini_salvate: 0,
      esclusi_non_attivi: 0,
      esclusi_fuori_produzione: 0,
      errori: [],
    };

    try {
      while (true) {
        const result = await callMexalApi({
          action: "sync",
          offset,
          batchSize: BATCH_SIZE,
          replaceStart: offset === 0,
        });

        totals.inseriti += Number(result.inseriti || 0);
        totals.aggiornati += Number(result.aggiornati || 0);
        totals.immagini_salvate += Number(result.immagini_salvate || 0);
        totals.esclusi_non_attivi += Number(result.esclusi_non_attivi || 0);
        totals.esclusi_fuori_produzione += Number(
          result.esclusi_fuori_produzione || 0
        );
        totals.errori.push(...(result.errori || []));

        offset = Number(result.prossimo_offset || offset + BATCH_SIZE);

        setSyncResult({
          ...totals,
          totale: result.totale,
          elaborati: Math.min(offset, result.totale),
          completato: result.completato,
        });

        if (result.completato) break;
      }

      await loadProducts();

      alert(
        `Sincronizzazione completata.\n\n` +
          `Inseriti: ${totals.inseriti}\n` +
          `Aggiornati: ${totals.aggiornati}\n` +
          `Immagini catalogo: ${totals.immagini_salvate}\n` +
          `Errori: ${totals.errori.length}`
      );
    } catch (error) {
      setSyncResult((current) => ({
        ...(current || totals),
        error: error.message,
      }));
      alert(error.message);
    } finally {
      setSyncingReal(false);
    }
  }

  const sectionCounts = useMemo(() => {
    const counts = { IT: 0, MKT: 0, IMP: 0 };

    products.forEach((product) => {
      const code = getProductCode(product);
      if (code.startsWith("MKT")) counts.MKT += 1;
      else if (code.startsWith("IMP")) counts.IMP += 1;
      else if (code.startsWith("IT")) counts.IT += 1;
    });

    return counts;
  }, [products]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();

    return products.filter((product) => {
      const code = getProductCode(product);
      if (!code.startsWith(activeSection)) return false;

      if (!text) return true;

      return [
        getProductDisplayName(product),
        product.codice_mexal,
        product.codice,
        product.brand_mexal,
        product.linea_mexal,
        product.categoria_mexal,
        product.sottocategoria_mexal,
        product.ean,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ")
        .includes(text);
    });
  }, [products, query, activeSection]);

  useEffect(() => {
    setSelected((current) => {
      if (current && filtered.some((item) => item.id === current.id)) {
        return current;
      }
      return filtered[0] || null;
    });
  }, [filtered]);

  const activeSectionInfo =
    SECTIONS.find((section) => section.id === activeSection) || SECTIONS[0];

  return (
    <div className="products-page v4-page">
      <div className="page-title-row">
        <div>
          <h1>Catalogo Mexal</h1>
          <p>
            Articoli attivi organizzati per tipologia. Sono esclusi gli articoli
            non attivi e quelli appartenenti a linee contenenti “Fuori Produzione”.
          </p>
        </div>
      </div>

      <div className="product-section-tabs" role="tablist" aria-label="Tipologie articolo">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const active = activeSection === section.id;

          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`product-section-tab ${active ? "active" : ""}`}
              onClick={() => {
                setActiveSection(section.id);
                setQuery("");
              }}
            >
              <span className="product-section-tab-icon"><Icon size={22} /></span>
              <span className="product-section-tab-copy">
                <strong>{section.title}</strong>
                <small>{section.description}</small>
              </span>
              <span className="product-section-tab-count">{sectionCounts[section.id]}</span>
            </button>
          );
        })}
      </div>

      <div className="v4-toolbar product-toolbar">
        <div className="task-search">
          <Search size={18} />
          <input
            placeholder={`Cerca in ${activeSectionInfo.title.toLowerCase()}...`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {canSyncMexal && (
          <button
            className="primary-action"
            type="button"
            onClick={synchronizeMexal}
            disabled={syncingReal}
          >
            <RefreshCw size={18} className={syncingReal ? "spin" : ""} />
            {syncingReal ? "Sincronizzazione..." : "Sincronizza Mexal"}
          </button>
        )}
      </div>

      {syncResult && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <h3>Risultato sincronizzazione</h3>
          {syncResult.error && (
            <p style={{ color: "#b91c1c" }}>{syncResult.error}</p>
          )}
          <div className="mini-meta">
            {syncResult.totale !== undefined && (
              <span>
                Avanzamento: {syncResult.elaborati || 0}/{syncResult.totale}
              </span>
            )}
            <span>Inseriti: {syncResult.inseriti || 0}</span>
            <span>Aggiornati: {syncResult.aggiornati || 0}</span>
            <span>Immagini catalogo: {syncResult.immagini_salvate || 0}</span>
            <span>Esclusi non attivi: {syncResult.esclusi_non_attivi || 0}</span>
            <span>
              Esclusi Fuori Produzione: {syncResult.esclusi_fuori_produzione || 0}
            </span>
            <span>Errori: {syncResult.errori?.length || 0}</span>
          </div>
        </div>
      )}

      <div className="product-layout">
        <div className="panel product-list-panel">
          <div className="panel-header">
            <h3>{activeSectionInfo.title}</h3>
            <span>{filtered.length}</span>
          </div>

          <div className="v4-list compact-list">
            {loading && <p>Caricamento articoli...</p>}
            {!loading && filtered.length === 0 && (
              <p>Nessun articolo disponibile in questa sezione.</p>
            )}
            {!loading &&
              filtered.map((product) => (
                <button
                  type="button"
                  key={product.id}
                  className={`v4-list-main product-row ${
                    selected?.id === product.id ? "active" : ""
                  }`}
                  onClick={() => setSelected(product)}
                >
                  <strong>{getProductDisplayName(product)}</strong>
                  <span>
                    {product.codice_mexal || product.codice || "-"} ·{" "}
                    {product.brand_mexal || "Brand non indicato"}
                  </span>
                  <small>
                    {[
                      product.linea_mexal,
                      product.categoria_mexal,
                      product.sottocategoria_mexal,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </button>
              ))}
          </div>
        </div>

        <div className="product-detail-stack">
          {!selected ? (
            <div className="panel">
              <p>Seleziona un articolo.</p>
            </div>
          ) : (
            <div className="panel product-hero">
              <span className="status-pill done">Attivo in Mexal</span>
              <h2>{getProductDisplayName(selected)}</h2>
              <p>{selected.descrizione || "Nessuna descrizione disponibile."}</p>

              {selected.immagine_catalogo_url && (
                <img
                  src={selected.immagine_catalogo_url}
                  alt={getProductDisplayName(selected)}
                  style={{
                    width: "100%",
                    maxWidth: 360,
                    maxHeight: 320,
                    objectFit: "contain",
                    borderRadius: 14,
                    border: "1px solid #e5e7eb",
                    background: "white",
                    margin: "14px 0",
                  }}
                />
              )}

              <div className="mini-meta">
                <span>Codice: {selected.codice_mexal || "-"}</span>
                <span>Brand: {selected.brand_mexal || "-"}</span>
                <span>Linea: {selected.linea_mexal || "-"}</span>
                <span>Categoria: {selected.categoria_mexal || "-"}</span>
                <span>Sottocategoria: {selected.sottocategoria_mexal || "-"}</span>
                <span>EAN: {selected.ean || "-"}</span>
                <span>Prezzo listino: {formatCurrency(selected.prezzo_listino)}</span>
                <span>Giacenza: {selected.giacenza ?? "-"}</span>
                <span>Disponibilità: {selected.disponibilita ?? "-"}</span>
                <span>
                  Ultimo sync:{" "}
                  {selected.ultimo_sync_mexal
                    ? new Date(selected.ultimo_sync_mexal).toLocaleString("it-IT")
                    : "-"}
                </span>
              </div>

              {selected.scheda_tecnica_url && (
                <a
                  className="primary-action"
                  href={selected.scheda_tecnica_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ marginTop: 18, display: "inline-flex" }}
                >
                  <FileText size={18} /> Scheda tecnica
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .product-section-tabs {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 18px;
        }

        .product-section-tab {
          width: 100%;
          min-width: 0;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 12px;
          padding: 18px;
          border: 1px solid #dbe3ee;
          border-radius: 16px;
          background: #ffffff;
          color: #172033;
          text-align: left;
          cursor: pointer;
          box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);
          transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
        }

        .product-section-tab:hover {
          transform: translateY(-1px);
          border-color: #93c5fd;
          box-shadow: 0 8px 22px rgba(37, 99, 235, 0.08);
        }

        .product-section-tab.active {
          border-color: #2563eb;
          background: #eff6ff;
          box-shadow: 0 8px 24px rgba(37, 99, 235, 0.12);
        }

        .product-section-tab-icon {
          width: 44px;
          height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          background: #eef2ff;
          color: #1d4ed8;
        }

        .product-section-tab-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .product-section-tab-copy strong {
          font-size: 16px;
        }

        .product-section-tab-copy small {
          color: #64748b;
          line-height: 1.35;
        }

        .product-section-tab-count {
          min-width: 38px;
          height: 38px;
          padding: 0 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: #f1f5f9;
          color: #0f172a;
          font-weight: 800;
        }

        .product-section-tab.active .product-section-tab-count {
          background: #2563eb;
          color: #ffffff;
        }

        .product-toolbar {
          align-items: center;
        }

        .spin {
          animation: product-sync-spin 1s linear infinite;
        }

        @keyframes product-sync-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @media (max-width: 900px) {
          .product-section-tabs {
            grid-template-columns: 1fr;
          }

          .product-list-panel .compact-list {
            max-height: 520px;
            overflow-y: auto;
          }

          .product-list-panel .product-row {
            min-height: 116px;
          }

          .product-toolbar {
            align-items: stretch;
          }

          .product-toolbar .primary-action {
            width: 100%;
            justify-content: center;
          }
        }
      `}</style>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { FileText, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";

const BATCH_SIZE = 8;

function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
  });
}

export default function Products() {
  const { profile, isAdminUser } = useAuth();
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [canSyncMexal, setCanSyncMexal] = useState(false);
  const [syncingTest, setSyncingTest] = useState(false);
  const [syncingReal, setSyncingReal] = useState(false);
  const [syncTestPassed, setSyncTestPassed] = useState(false);
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
    setSelected((current) =>
      rows.find((item) => item.id === current?.id) || rows[0] || null
    );
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

    const { data } = await supabase
      .from("integrazioni_utenti")
      .select("enabled,ruolo_ordini")
      .eq("utente_id", profile.id)
      .eq("modulo", "gestione_ordini")
      .maybeSingle();

    setCanSyncMexal(data?.enabled === true && data?.ruolo_ordini === "backoffice");
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

  async function testMexal() {
    setSyncingTest(true);
    setSyncResult(null);
    setSyncTestPassed(false);

    try {
      const result = await callMexalApi({ action: "test" });
      setSyncResult(result);
      setSyncTestPassed(true);
      alert(`Test Mexal completato. Articoli IT*, MKT* e IMP* trovati: ${result.selezionati || 0}.`);
    } catch (error) {
      setSyncResult({ error: error.message });
      alert(error.message);
    } finally {
      setSyncingTest(false);
    }
  }

  async function synchronizeMexal() {
    if (!syncTestPassed) {
      alert("Esegui prima il test Mexal.");
      return;
    }

    if (
      !window.confirm(
        "Avviare la sincronizzazione del catalogo con gli articoli attivi di Mexal?\n\n" +
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
      setSyncResult((current) => ({ ...(current || totals), error: error.message }));
      alert(error.message);
    } finally {
      setSyncingReal(false);
    }
  }

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return products;

    return products.filter((product) =>
      [
        product.nome,
        product.codice_mexal,
        product.brand_mexal,
        product.linea_mexal,
        product.categoria_mexal,
        product.sottocategoria_mexal,
        product.ean,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ")
        .includes(text)
    );
  }, [products, query]);

  return (
    <div className="products-page v4-page">
      <div className="page-title-row">
        <div>
          <h1>Prodotti</h1>
          <p>
            Catalogo in sola lettura sincronizzato da Mexal. Sono visibili esclusivamente gli articoli attivi.
          </p>
        </div>
      </div>

      <div className="v4-toolbar">
        <div className="task-search">
          <Search size={18} />
          <input
            placeholder="Cerca prodotto, codice, brand, linea, categoria..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {canSyncMexal && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="secondary-action"
              type="button"
              onClick={testMexal}
              disabled={syncingTest || syncingReal}
            >
              <RefreshCw size={18} className={syncingTest ? "spin" : ""} />
              {syncingTest ? "Test in corso..." : "Test Mexal"}
            </button>

            <button
              className="primary-action"
              type="button"
              onClick={synchronizeMexal}
              disabled={!syncTestPassed || syncingTest || syncingReal}
            >
              <RefreshCw size={18} className={syncingReal ? "spin" : ""} />
              {syncingReal ? "Sincronizzazione..." : "Sincronizza Mexal"}
            </button>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 18, background: "#f8fafc" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ShieldCheck size={21} />
          <strong>Archivio protetto</strong>
        </div>
        <p style={{ marginBottom: 0 }}>
          Sali-task non può creare, modificare o eliminare articoli. Tutti i dati provengono esclusivamente da Mexal.
        </p>
      </div>

      {syncResult && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <h3>Risultato sincronizzazione</h3>
          {syncResult.error && <p style={{ color: "#b91c1c" }}>{syncResult.error}</p>}
          <div className="mini-meta">
            {syncResult.selezionati !== undefined && (
              <span>Articoli IT*, MKT*, IMP*: {syncResult.selezionati}</span>
            )}
            {syncResult.totale !== undefined && (
              <span>
                Avanzamento: {syncResult.elaborati || 0}/{syncResult.totale}
              </span>
            )}
            <span>Inseriti: {syncResult.inseriti || 0}</span>
            <span>Aggiornati: {syncResult.aggiornati || 0}</span>
            <span>Immagini catalogo: {syncResult.immagini_salvate || 0}</span>
            <span>Errori: {syncResult.errori?.length || 0}</span>
          </div>
        </div>
      )}

      <div className="product-layout">
        <div className="panel product-list-panel">
          <div className="panel-header">
            <h3>Articoli attivi</h3>
            <span>{filtered.length}</span>
          </div>

          <div className="v4-list compact-list">
            {loading && <p>Caricamento prodotti...</p>}
            {!loading && filtered.length === 0 && <p>Nessun prodotto disponibile.</p>}
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
                  <strong>{product.nome}</strong>
                  <span>
                    {product.codice_mexal || product.codice || "-"} ·{" "}
                    {product.brand_mexal || "Brand non indicato"}
                  </span>
                  <small>
                    {[product.linea_mexal, product.categoria_mexal, product.sottocategoria_mexal]
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
              <p>Seleziona un prodotto.</p>
            </div>
          ) : (
            <div className="panel product-hero">
              <span className="status-pill done">Attivo in Mexal</span>
              <h2>{selected.nome}</h2>
              <p>{selected.descrizione || "Nessuna descrizione disponibile."}</p>

              {selected.immagine_catalogo_url && (
                <img
                  src={selected.immagine_catalogo_url}
                  alt={selected.nome}
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
        .spin { animation: product-sync-spin 1s linear infinite; }
        @keyframes product-sync-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

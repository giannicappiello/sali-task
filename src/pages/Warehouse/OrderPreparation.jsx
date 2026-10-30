import { useCallback, useEffect, useRef, useState } from "react";

import { useSearchParams } from "react-router-dom";

import {
  Camera,
  Package,
  Truck,
  ScanLine,
  CheckCircle2,
  RefreshCw,
  Settings,
  ArrowLeft,
  FileDown,
  Maximize,
} from "lucide-react";

import BarcodeCamera from "./BarcodeCamera.jsx";

import { preparationApi } from "./preparationApi.js";

import { preparationPdf } from "./preparationPdf.js";

import { comparePacking } from "../../../shared/orderPreparation.js";

import "./orderPreparation.css";

const labels = {
  draft: "In preparazione",
  verified: "Riscontro OK",
  exporting: "Invio DDT da verificare",
  uncertain: "Esito DDT da verificare",
  completed: "DDT emesso",
  cancelled: "Annullata",
};

const format = (q) => Number(q || 0).toLocaleString("it-IT");

function PreparationSettings({ onClose, onSaved }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);

  const [series, setSeries] = useState(""),
    [warehouse, setWarehouse] = useState("5"),
    [code, setCode] = useState(""),
    [barcode, setBarcode] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await preparationApi("settings");
      setData(r);
      setSeries(r.settings.ddt_series || "");
      setWarehouse(r.settings.default_warehouse);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // Load server-owned data when the route changes.

  useEffect(() => {
    // Fetch server-owned data when this view becomes active.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function save(op, input) {
    setBusy(true);
    setError("");
    try {
      await preparationApi(op, input);
      await load();
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="op-settings"
      aria-label="Configurazione Allestisci Ordini"
    >
      <div className="op-toolbar">
        <h2>Configurazione allestimenti</h2>
        <button onClick={onClose}>Chiudi</button>
      </div>

      {error && (
        <p className="op-error" role="alert">
          {error}
        </p>
      )}

      {!data ? (
        <p>Caricamento configurazione…</p>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save("configure", {
                ddtSeries: series ? Number(series) : null,
                warehouse: Number(warehouse),
              });
            }}
          >
            <label>
              Serie DDT (BC)
              <input
                type="number"
                min="1"
                value={series}
                onChange={(e) => setSeries(e.target.value)}
                disabled={!data.canConfigure || busy}
              />
            </label>

            <label>
              Magazzino se assente sull’OCM
              <input
                type="number"
                min="1"
                value={warehouse}
                onChange={(e) => setWarehouse(e.target.value)}
                disabled={!data.canConfigure || busy}
              />
            </label>

            {data.canConfigure && (
              <button disabled={busy}>Salva configurazione</button>
            )}
          </form>

          <h3>Barcode personalizzati</h3>
          <p>
            Lo stesso barcode vale un pezzo in modalità Pezzo e un cartone in
            modalità Cartone. I pezzi per cartone vengono letti automaticamente
            dal capitolato prodotto in Documenti Private, sezione Imballo. Se il
            dato manca, alla lettura di un cartone ti verrà chiesto di
            inserirlo: sarà salvato nel capitolato.
          </p>

          {data.canConfigure && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save("configure_product", {
                  code,
                  barcode,
                });
              }}
            >
              <label>
                Codice articolo
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  required
                  maxLength={80}
                />
              </label>

              <label>
                Barcode (opzionale, mantiene gli zeri iniziali)
                <input
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  maxLength={100}
                />
              </label>

              <button disabled={busy}>Salva articolo</button>
            </form>
          )}

          <div className="op-table-wrap">
            <table data-column-controls="off">
              <thead>
                <tr>
                  <th>Articolo</th>
                  <th>Barcode</th>
                  <th>Pezzi/cartone</th>
                  <th>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((p) => (
                  <tr key={p.code}>
                    <td data-label="Articolo">{p.code}</td>
                    <td data-label="Barcode">
                      {p.barcode || "Anagrafica Mexal"}
                    </td>
                    <td data-label="Pezzi/cartone">
                      {p.pieces_per_carton || "Da compilare nel capitolato"}
                      {p.specification_version && (
                        <small>
                          Capitolato revisione {p.specification_version}
                        </small>
                      )}
                    </td>
                    <td data-label="Azioni">
                      {data.canConfigure && (
                        <button
                          onClick={() => {
                            setCode(p.code);
                            setBarcode(p.barcode || "");
                          }}
                        >
                          Modifica
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.products.length && (
            <p className="op-empty">
              Nessun barcode personalizzato. Sono utilizzati i barcode Mexal e i
              pezzi per cartone del capitolato prodotto.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default function OrderPreparation() {
  const [params, setParams] = useSearchParams(),
    id = params.get("id"),
    [orders, setOrders] = useState([]),
    [history, setHistory] = useState([]),
    [sync, setSync] = useState(null),
    [row, setRow] = useState(null);

  const [canWrite, setCanWrite] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [cartonPrompt, setCartonPrompt] = useState(null),
    [cartonPieces, setCartonPieces] = useState("");

  const [query, setQuery] = useState(""),
    [camera, setCamera] = useState(false),
    [mode, setMode] = useState("piece"),
    [activePackage, setActivePackage] = useState(""),
    [barcode, setBarcode] = useState("");

  const [settings, setSettings] = useState(false),
    [check, setCheck] = useState(null),
    [confirmedLots, setConfirmedLots] = useState(false),
    [confirmDdt, setConfirmDdt] = useState(false),
    [pending, setPending] = useState(null);

  const current = useRef(row),
    lock = useRef(false),
    input = useRef(null),
    cartonInput = useRef(null);
  useEffect(() => {
    if (cartonPrompt) cartonInput.current?.focus();
  }, [cartonPrompt]);
  useEffect(() => {
    current.current = row;
  }, [row]);

  const accept = useCallback((r) => {
    setRow(r);
    setCheck(r.verification);
    setConfirmedLots(false);
    setConfirmDdt(false);
    setActivePackage((old) =>
      r.state.packages.some((p) => p.id === old)
        ? old
        : r.state.packages[0]?.id || "",
    );
  }, []);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError("");
      setNotice("");
      setCartonPrompt(null);
      try {
        const r = await preparationApi(
          id ? "get" : "list",
          id ? { id } : { refresh },
        );
        setCanWrite(r.canWrite);

        if (r.preparation) accept(r.preparation);
        else {
          setCamera(false);
          setPending(null);
          setOrders(r.orders);
          setHistory(r.preparations);
          setSync(r.sync);
          setRow(null);
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [id, accept],
  );

  // Load server-owned data when the route changes.

  useEffect(() => {
    // Fetch server-owned data when this view becomes active.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function perform(operation, extra = {}, retryBody = null) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");

    const r = current.current,
      body = retryBody || {
        id: r?.id,
        version: r?.version,
        eventId: crypto.randomUUID(),
        ...extra,
      };

    try {
      const response = await preparationApi(operation, body);
      setPending(null);
      if (response.requiresCartonPieces) {
        setCartonPrompt({ code: response.product.code, body });
        setCartonPieces("");
        return response;
      }
      if (operation === "scan" && response.scan) setCartonPrompt(null);
      if (response.preparation) accept(response.preparation);

      if (response.verification) setCheck(response.verification);

      if (response.warning) setNotice(response.warning);
      if (
        ["export", "reconcile"].includes(operation) &&
        response.preparation?.status === "completed"
      ) {
        try {
          preparationPdf(response.preparation);
        } catch (e) {
          setError(
            "DDT confermato. Riprova il download della packing list: " +
              e.message,
          );
        }
      }

      if (response.scan) {
        setNotice(
          `${response.scan.code}: +${response.scan.quantity} pezzi${response.scan.wrong ? " · PRODOTTO NON PREVISTO NELL’ORDINE" : ""}`,
        );
        if (response.scan.wrong)
          setError(
            "Prodotto estraneo all’OCM: rimuovi la lettura se inserita per errore.",
          );
        navigator.vibrate?.(80);
      }

      if (operation === "begin") {
        setParams({ id: response.preparation.id });
        setTimeout(() => setCamera(true), 0);
      }

      if (operation === "verify" && response.verification?.ok)
        setNotice(
          "Riscontro positivo. Conferma il prelievo dei lotti FIFO prima del DDT.",
        );

      return response;
    } catch (e) {
      setError(e.message);
      if (!e.status || e.status >= 500) setPending({ operation, body });
      if (e.status === 409) await load();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const scan = async (value) => {
    if (!canWrite || !activePackage || cartonPrompt) return;
    const response = await perform("scan", {
      barcode: value,
      mode,
      packageId: activePackage,
    });
    setBarcode("");
    if (!response?.requiresCartonPieces) input.current?.focus();
  };

  const editable =
    canWrite && row && ["draft", "verified"].includes(row.status);

  const comparison = row ? comparePacking(row.source.lines, row.state) : null;

  const source = row?.source,
    scans = row?.state.scans || [],
    packages = row?.state.packages || [],
    pallets = row?.state.pallets || [];

  const totalPieces = scans.reduce((n, s) => n + s.quantity, 0),
    totalExpected = source?.lines.reduce((n, l) => n + l.quantity, 0) || 0;

  const prepared = (order) =>
    history.find(
      (h) =>
        h.source.reference === order.reference && h.source.year === order.year,
    );

  return (
    <main className="order-preparation">
      <header className="op-heading">
        <div>
          <span className="op-eyebrow">Logistica</span>
          <h1>
            <Package aria-hidden="true" /> Allestisci Ordini
          </h1>
          <p>
            Prepara gli OCM consegnati al magazzino, riscontra i prodotti e
            organizza la spedizione.
          </p>
        </div>

        <div className="op-toolbar">
          {id && (
            <button
              onClick={() => {
                setCamera(false);
                setParams({});
              }}
            >
              <ArrowLeft size={16} />
              Elenco ordini
            </button>
          )}
          <button onClick={() => void load(true)} disabled={busy || loading}>
            <RefreshCw size={16} />
            Aggiorna
          </button>

          <button
            onClick={() =>
              document.documentElement.requestFullscreen?.().catch(() => {})
            }
          >
            <Maximize size={16} />
            Schermo intero
          </button>
          <button onClick={() => setSettings((v) => !v)}>
            <Settings size={16} />
            Configurazione
          </button>
        </div>
      </header>

      {error && (
        <div className="op-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="op-notice" role="status">
          {notice}
        </div>
      )}

      {pending && (
        <div className="op-notice">
          Risposta non confermata. Riprova la stessa operazione: la lettura non
          verrà duplicata.
          <button
            disabled={busy}
            onClick={() => void perform(pending.operation, {}, pending.body)}
          >
            Verifica / riprova
          </button>
        </div>
      )}

      {settings && (
        <PreparationSettings
          onClose={() => setSettings(false)}
          onSaved={() => setNotice("Configurazione salvata.")}
        />
      )}

      {!id && sync && (
        <p className="op-sync" role="status">
          {sync.lastSyncedAt
            ? `Ultima sincronizzazione: ${new Date(sync.lastSyncedAt).toLocaleString("it-IT", { timeZone: "Europe/Rome" })}. `
            : ""}
          {sync.enabled
            ? "Sincronizzazione automatica ogni giorno alle 12:00 (ora italiana)."
            : "Sincronizzazione automatica in attivazione."}
          {sync.inProgress && " Aggiornamento in corso."}
          {sync.lastError && (
            <span className="op-bad">
              {" "}
              Ultimo aggiornamento non riuscito: {sync.lastError}. Sono mostrati
              gli ultimi dati disponibili.
            </span>
          )}
        </p>
      )}
      {loading ? (
        <p className="op-empty">Caricamento allestimenti…</p>
      ) : !row ? (
        <div className="op-order-lists">
          <section className="op-panel">
            <div className="op-toolbar">
              <h2>OCM da allestire</h2>
              <label>
                Cerca ordine o cliente
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Numero OCM, cliente…"
                />
              </label>
            </div>

            <p>
              Solo OCM Mexal con «consegnato mgz» nelle note. Le righe evadibili
              saranno verificate all’apertura.
            </p>

            <div className="op-table-wrap">
              <table data-column-controls="off">
                <thead>
                  <tr>
                    <th>OCM</th>
                    <th>Data</th>
                    <th>Cliente</th>
                    <th>Note</th>
                    <th>Stato</th>
                    <th>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {orders
                    .filter((o) =>
                      `${o.number} ${o.customerName} ${o.customerCode}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map((o) => {
                      const prep = prepared(o);
                      return (
                        <tr key={`${o.year}:${o.reference}`}>
                          <td data-label="OCM">
                            <strong>
                              {o.series}/{o.number}
                            </strong>
                          </td>
                          <td data-label="Data">
                            {String(o.date).replace(
                              /^(\d{4})(\d{2})(\d{2})$/,
                              "$3/$2/$1",
                            )}
                          </td>
                          <td data-label="Cliente">
                            {o.customerName}
                            <small>{o.customerCode}</small>
                          </td>
                          <td data-label="Note">{o.note}</td>
                          <td data-label="Stato">
                            {prep ? labels[prep.status] : "Da preparare"}
                          </td>
                          <td data-label="Azioni">
                            {prep ? (
                              <button
                                onClick={() => setParams({ id: prep.id })}
                              >
                                Apri preparazione
                              </button>
                            ) : (
                              <button
                                className="op-primary"
                                disabled={!canWrite || busy}
                                onClick={() =>
                                  void perform("begin", {
                                    reference: o.reference,
                                  })
                                }
                              >
                                Allestisci
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {!orders.length && (
                <p className="op-empty">
                  Nessun OCM con la nota «consegnato mgz» trovato in Mexal.
                </p>
              )}
            </div>
          </section>

          <section className="op-panel">
            <h2>Preparazioni salvate e spedizioni</h2>
            <div className="op-table-wrap">
              <table data-column-controls="off">
                <thead>
                  <tr>
                    <th>OCM</th>
                    <th>Cliente</th>
                    <th>Stato</th>
                    <th>DDT</th>
                    <th>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((p) => (
                    <tr key={p.id}>
                      <td data-label="OCM">
                        {p.source.series}/{p.source.number} · {p.source.year}
                      </td>
                      <td data-label="Cliente">{p.source.customerName}</td>
                      <td data-label="Stato">{labels[p.status]}</td>
                      <td data-label="DDT">
                        {p.ddt ? `${p.ddt.series}/${p.ddt.number}` : "—"}
                      </td>
                      <td data-label="Azioni">
                        <button onClick={() => setParams({ id: p.id })}>
                          Apri
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!history.length && (
                <p className="op-empty">
                  Le preparazioni salvate compariranno qui.
                </p>
              )}
            </div>
          </section>
        </div>
      ) : (
        <>
          <section className="op-panel op-order">
            <div>
              <h2>
                OCM {source.series}/{source.number} · {source.customerName}
              </h2>
              <p>{source.note}</p>
              <span className={`op-status op-status-${row.status}`}>
                {labels[row.status]}
              </span>
            </div>

            <div className="op-counts">
              <span>
                <strong>
                  {format(totalPieces)} / {format(totalExpected)}
                </strong>
                Pezzi letti
              </span>
              <span>
                <strong>{packages.length}</strong>Colli
              </span>
              <span>
                <strong>{pallets.length}</strong>Bancali
              </span>
            </div>
          </section>

          {editable && (
            <section className="op-panel">
              <h2>
                <ScanLine size={20} /> Scansione prodotti
              </h2>
              <div className="op-scan-controls">
                <label>
                  Modalità
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                    disabled={busy || !!cartonPrompt}
                  >
                    <option value="piece">Pezzo · 1 pezzo per lettura</option>
                    <option value="carton">
                      Cartone · pezzi dal capitolato
                    </option>
                  </select>
                </label>

                <label>
                  Collo attivo
                  <select
                    value={activePackage}
                    onChange={(e) => setActivePackage(e.target.value)}
                    disabled={busy || !!cartonPrompt}
                  >
                    {packages.map((p) => (
                      <option key={p.id} value={p.id}>
                        Collo {p.number}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  onClick={() => setCamera((v) => !v)}
                  disabled={!packages.length || !!cartonPrompt}
                >
                  <Camera size={17} />
                  {camera ? "Chiudi fotocamera" : "Apri fotocamera"}
                </button>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void scan(barcode);
                  }}
                >
                  <label>
                    Barcode prodotto
                    <input
                      disabled={busy || !!cartonPrompt}
                      ref={input}
                      autoComplete="off"
                      value={barcode}
                      onChange={(e) => setBarcode(e.target.value)}
                      placeholder="Scansiona o inserisci il barcode"
                      maxLength={100}
                    />
                  </label>
                  <button
                    className="op-primary"
                    disabled={
                      busy || !!cartonPrompt || !barcode || !activePackage
                    }
                  >
                    Aggiungi {mode === "piece" ? "pezzo" : "cartone"}
                  </button>
                </form>
              </div>
              <p className="op-mode">
                Modalità attiva:{" "}
                <strong>{mode === "piece" ? "PEZZO" : "CARTONE"}</strong> ·
                Destinazione:{" "}
                <strong>
                  Collo{" "}
                  {packages.find((p) => p.id === activePackage)?.number ||
                    "da selezionare"}
                </strong>
              </p>

              {cartonPrompt && (
                <form
                  className="op-notice op-carton-prompt"
                  aria-label="Pezzi per cartone mancanti"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void perform(
                      "scan",
                      {},
                      {
                        ...cartonPrompt.body,
                        piecesPerCarton: Number(cartonPieces),
                      },
                    );
                  }}
                >
                  <h3>Pezzi per cartone · {cartonPrompt.code}</h3>
                  <p>
                    Il dato manca nel capitolato. Indica quanti pezzi contiene
                    questo cartone: il valore sarà salvato nel capitolato
                    prodotto, sezione Imballo, e usato anche per le prossime
                    letture.
                  </p>
                  <label>
                    Pezzi per cartone
                    <input
                      ref={cartonInput}
                      type="number"
                      min="1"
                      max="1000000"
                      step="1"
                      inputMode="numeric"
                      required
                      value={cartonPieces}
                      onChange={(e) => setCartonPieces(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <div className="op-toolbar">
                    <button
                      className="op-primary"
                      disabled={busy || !cartonPieces}
                    >
                      Salva nel capitolato e aggiungi cartone
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setCartonPrompt(null);
                        input.current?.focus();
                      }}
                    >
                      Annulla lettura
                    </button>
                  </div>
                </form>
              )}
              <BarcodeCamera
                enabled={camera}
                onRead={scan}
                onClose={() => setCamera(false)}
                paused={busy || !!pending || !!cartonPrompt}
              />
            </section>
          )}

          <section className="op-panel">
            <h2>Prodotti dell’ordine</h2>
            <div className="op-table-wrap">
              <table data-column-controls="off">
                <thead>
                  <tr>
                    <th>Articolo</th>
                    <th>Barcode</th>
                    <th>Richiesti</th>
                    <th>Letti</th>
                    <th>Riscontro</th>
                  </tr>
                </thead>
                <tbody>
                  {[...new Set(source.lines.map((l) => l.code))].map((code) => {
                    const line = source.lines.find((l) => l.code === code),
                      expected = source.lines
                        .filter((l) => l.code === code)
                        .reduce((n, l) => n + l.quantity, 0),
                      actual = scans
                        .filter((s) => s.code === code)
                        .reduce((n, s) => n + s.quantity, 0);

                    const lastCarton = scans.findLast(
                      (s) =>
                        s.code === code &&
                        s.mode === "carton" &&
                        s.specificationVersion,
                    );
                    const piecesPerCarton =
                      lastCarton?.quantity || line.piecesPerCarton;
                    const specificationVersion =
                      lastCarton?.specificationVersion ||
                      line.packagingSpecificationVersion;
                    return (
                      <tr key={code}>
                        <td data-label="Articolo">
                          <strong>{code}</strong>
                          <small>{line.description}</small>
                          <small>
                            {piecesPerCarton && specificationVersion
                              ? `${format(piecesPerCarton)} pezzi/cartone · Capitolato rev. ${specificationVersion}`
                              : "Cartone: compila i pezzi nel capitolato prodotto"}
                          </small>
                        </td>
                        <td data-label="Barcode">
                          {line.barcode || "Da configurare"}
                        </td>
                        <td data-label="Richiesti">{format(expected)}</td>
                        <td data-label="Letti">{format(actual)}</td>
                        <td
                          data-label="Riscontro"
                          className={
                            actual === expected
                              ? "op-good"
                              : actual > expected
                                ? "op-bad"
                                : ""
                          }
                        >
                          {actual === expected
                            ? "Completo"
                            : actual > expected
                              ? `In più: ${format(actual - expected)}`
                              : `Mancano ${format(expected - actual)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {row.status !== "completed" &&
            (source.fifoProposal?.length > 0 || source.fifoIssue) && (
              <section className="op-panel">
                <h2>Lotti FIFO da prelevare</h2>
                <p>
                  Preleva i lotti indicati, partendo da quello entrato per
                  primo. Il barcode identifica il prodotto, non il lotto.
                </p>
                {source.fifoIssue && (
                  <p className="op-error">{source.fifoIssue}</p>
                )}
                <LotTable
                  allocations={
                    row.verification?.allocations || source.fifoProposal || []
                  }
                />
              </section>
            )}

          <section className="op-panel">
            <div className="op-toolbar">
              <h2>Colli e bancali</h2>
              {editable && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform("add_package", {
                        packageId: crypto.randomUUID(),
                      })
                    }
                  >
                    <Package size={16} />
                    Nuovo collo
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform("add_pallet", {
                        palletId: crypto.randomUUID(),
                      })
                    }
                  >
                    <Truck size={16} />
                    Nuovo bancale
                  </button>
                </>
              )}
            </div>

            <div className="op-package-grid">
              {packages.map((p) => (
                <article
                  key={p.id}
                  className={
                    p.id === activePackage ? "op-package active" : "op-package"
                  }
                >
                  <div className="op-toolbar">
                    <h3>Collo {p.number}</h3>
                    <strong>
                      {format(
                        scans
                          .filter((s) => s.packageId === p.id)
                          .reduce((n, s) => n + s.quantity, 0),
                      )}{" "}
                      {scans
                        .filter((s) => s.packageId === p.id)
                        .reduce((n, s) => n + s.quantity, 0) === 1
                        ? "pezzo"
                        : "pezzi"}
                    </strong>
                  </div>

                  <label>
                    Bancale
                    <select
                      value={p.palletId || ""}
                      disabled={!editable || busy}
                      onChange={(e) =>
                        void perform("assign", {
                          packageId: p.id,
                          palletId: e.target.value || null,
                        })
                      }
                    >
                      <option value="">Senza bancale</option>
                      {pallets.map((b) => (
                        <option key={b.id} value={b.id}>
                          Bancale {b.number}
                        </option>
                      ))}
                    </select>
                  </label>

                  <ul>
                    {[
                      ...new Set(
                        scans
                          .filter((s) => s.packageId === p.id)
                          .map((s) => s.code),
                      ),
                    ].map((code) => (
                      <li key={code}>
                        {code}{" "}
                        <strong>
                          {format(
                            scans
                              .filter(
                                (s) => s.packageId === p.id && s.code === code,
                              )
                              .reduce((n, s) => n + s.quantity, 0),
                          )}{" "}
                          pz
                        </strong>
                      </li>
                    ))}
                  </ul>

                  {editable && (
                    <div className="op-toolbar">
                      <button onClick={() => setActivePackage(p.id)}>
                        Usa questo collo
                      </button>
                      <button
                        disabled={
                          busy || scans.some((s) => s.packageId === p.id)
                        }
                        onClick={() =>
                          void perform("remove_package", { packageId: p.id })
                        }
                      >
                        Rimuovi vuoto
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>

            {pallets.map((b) => (
              <div key={b.id} className="op-pallet">
                Bancale {b.number}:{" "}
                <strong>
                  {packages.filter((p) => p.palletId === b.id).length} cartoni
                </strong>
                {editable && (
                  <button
                    disabled={busy || packages.some((p) => p.palletId === b.id)}
                    onClick={() =>
                      void perform("remove_pallet", { palletId: b.id })
                    }
                  >
                    Rimuovi vuoto
                  </button>
                )}
              </div>
            ))}
          </section>

          <section className="op-panel">
            <h2>Ultime letture</h2>
            <div className="op-table-wrap">
              <table data-column-controls="off">
                <thead>
                  <tr>
                    <th>Prodotto</th>
                    <th>Modalità</th>
                    <th>Pezzi</th>
                    <th>Collo</th>
                    <th>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {scans
                    .slice(-30)
                    .reverse()
                    .map((s) => (
                      <tr key={s.id}>
                        <td data-label="Prodotto">{s.code}</td>
                        <td data-label="Modalità">
                          {s.mode === "piece" ? "Pezzo" : "Cartone"}
                        </td>
                        <td data-label="Pezzi">{s.quantity}</td>
                        <td data-label="Collo">
                          {packages.find((p) => p.id === s.packageId)?.number}
                        </td>
                        <td data-label="Azioni">
                          {editable && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void perform("undo", { scanId: s.id })
                              }
                            >
                              Annulla lettura
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!scans.length && (
                <p className="op-empty">Nessuna lettura registrata.</p>
              )}
            </div>
          </section>

          <section className="op-panel">
            <h2>
              <CheckCircle2 size={20} /> Riscontro e documenti
            </h2>

            {(check || comparison)?.discrepancies?.map((d) => (
              <p key={d.code} className="op-error">
                {d.code}:{" "}
                {d.kind === "wrong"
                  ? "prodotto estraneo all’ordine"
                  : d.missing
                    ? `mancano ${format(d.missing)} pezzi`
                    : `${format(d.extra)} pezzi in più`}
              </p>
            ))}

            {(check || comparison)?.packagingErrors?.map((e) => (
              <p key={e} className="op-error">
                {e}
              </p>
            ))}

            {editable && (
              <button
                className="op-primary"
                disabled={busy || !scans.length}
                onClick={() => {
                  setCamera(false);
                  void perform("verify");
                }}
              >
                Riscontra
              </button>
            )}

            {row.status === "verified" && check?.ok && (
              <>
                <p className="op-good">
                  Articoli, quantità e imballi corrispondono all’OCM.
                </p>
                <LotTable allocations={check.allocations} />

                <label className="op-confirm">
                  <input
                    type="checkbox"
                    checked={confirmedLots}
                    disabled={busy}
                    onChange={(e) => setConfirmedLots(e.target.checked)}
                  />
                  Confermo di aver prelevato e confezionato i lotti FIFO
                  indicati.
                </label>

                {editable && (
                  <button
                    className="op-primary"
                    disabled={busy || !confirmedLots}
                    onClick={() => setConfirmDdt(true)}
                  >
                    Genera DDT e packing list
                  </button>
                )}
              </>
            )}

            {confirmDdt && (
              <div
                className="op-confirm-box"
                role="group"
                aria-label="Conferma emissione DDT"
              >
                <h3>Conferma emissione DDT su Mexal</h3>
                <p>
                  OCM {source.series}/{source.number} · {source.customerName} ·{" "}
                  {totalPieces} pezzi · {packages.length} colli ·{" "}
                  {pallets.length} bancali.
                </p>
                <p>Il DDT evaderà l’OCM e movimenterà i lotti confermati.</p>
                <button disabled={busy} onClick={() => setConfirmDdt(false)}>
                  Indietro
                </button>
                <button
                  className="op-primary"
                  disabled={busy}
                  onClick={() => void perform("export", { confirmedLots })}
                >
                  Conferma e crea DDT
                </button>
              </div>
            )}

            {["uncertain", "exporting"].includes(row.status) && (
              <div className="op-notice">
                <p>
                  Il documento potrebbe essere già presente in Mexal. Verifica
                  l’esito; non ripetere l’emissione.
                </p>
                <button
                  disabled={busy || !canWrite}
                  onClick={() => void perform("reconcile")}
                >
                  Verifica esito DDT
                </button>
              </div>
            )}

            {row.status === "cancelled" && canWrite && (
              <button disabled={busy} onClick={() => void perform("reopen")}>
                Riprendi preparazione annullata
              </button>
            )}

            {row.ddt && (
              <p className="op-good">
                DDT {row.ddt.series}/{row.ddt.number} confermato in Mexal.
              </p>
            )}

            {row.verification?.summary && (
              <button
                disabled={busy}
                onClick={() => {
                  try {
                    preparationPdf(row);
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                <FileDown size={16} />
                {row.ddt
                  ? "Scarica packing list"
                  : "Anteprima packing list · bozza"}
              </button>
            )}

            {editable && (
              <details className="op-cancel">
                <summary>Annulla preparazione</summary>
                <p>
                  Le letture restano nello storico e le riserve FIFO vengono
                  liberate.
                </p>
                <button
                  disabled={busy}
                  onClick={() => {
                    setCamera(false);
                    void perform("cancel");
                  }}
                >
                  Conferma annullamento
                </button>
              </details>
            )}
          </section>
        </>
      )}

      {busy && (
        <div className="op-working" role="status">
          Operazione in corso…
        </div>
      )}
    </main>
  );
}

function LotTable({ allocations }) {
  return (
    <div className="op-table-wrap">
      <table data-column-controls="off">
        <thead>
          <tr>
            <th>Articolo</th>
            <th>Lotto</th>
            <th>Ingresso</th>
            <th>Magazzino</th>
            <th>Pezzi</th>
          </tr>
        </thead>
        <tbody>
          {allocations.map((a, i) => (
            <tr key={`${a.position}:${a.lotId}:${i}`}>
              <td data-label="Articolo">{a.code}</td>
              <td data-label="Lotto">{a.lotCode || "Non gestito a lotti"}</td>
              <td data-label="Ingresso">
                {a.entryDate?.replace(/^(\d{4})(\d{2})(\d{2})$/, "$3/$2/$1") ||
                  "—"}
              </td>
              <td data-label="Magazzino">{a.warehouse}</td>
              <td data-label="Pezzi">{format(a.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";

import { useSearchParams } from "react-router-dom";

import {
  Camera,
  Package,
  Truck,
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

import {
  comparePacking,
  cleanWarehouseHandoffNote,
} from "../../../shared/orderPreparation.js";

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
              Serie DDT (BCS)
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
    [activePallet, setActivePallet] = useState(""),
    [draftPackage, setDraftPackage] = useState(null);

  const [settings, setSettings] = useState(false),
    [check, setCheck] = useState(null),
    [confirmedLots, setConfirmedLots] = useState(false),
    [confirmDdt, setConfirmDdt] = useState(false),
    [ddtNotes, setDdtNotes] = useState(""),
    [pending, setPending] = useState(null);

  const current = useRef(row),
    lock = useRef(false),
    input = useRef(null),
    cartonInput = useRef(null),
    selection = useRef({ activePackage: "", activePallet: "" });
  useEffect(() => {
    selection.current = { activePackage, activePallet };
  }, [activePackage, activePallet]);
  useEffect(() => {
    if (cartonPrompt) cartonInput.current?.focus();
  }, [cartonPrompt]);
  useEffect(() => {
    current.current = row;
  }, [row]);

  const accept = useCallback((r, preserveFifo = false) => {
    const prior=current.current;
    if(preserveFifo && prior?.id===r.id && !prior.source.fifoIssue && prior.source.fifoProposal?.length && r.source.fifoIssue){
      r={...r,source:{...r.source,fifoProposal:prior.source.fifoProposal}};
      delete r.source.fifoIssue;
    }
    current.current = r;
    setRow(r);
    setDraftPackage(null);
    const selectedPallet =
      r.state.pallets.find(
        (item) => item.id === selection.current.activePallet,
      ) || r.state.pallets[0];
    const selectedPackage =
      r.state.packages.find(
        (item) =>
          item.id === selection.current.activePackage &&
          item.palletId === selectedPallet?.id,
      ) ||
      r.state.packages.find((item) => item.palletId === selectedPallet?.id);
    setActivePallet(selectedPallet?.id || "");
    if(!selectedPackage && selectedPallet){
      const next={id:crypto.randomUUID(),number:Math.max(0,...r.state.packages.map(item=>item.number))+1,palletId:selectedPallet.id};
      setDraftPackage(next);setActivePackage(next.id);
    }else setActivePackage(selectedPackage?.id || "");
    setCheck(r.verification);
    setConfirmedLots(false);
    setConfirmDdt(false);
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
      if (operation === "scan" && response.preparation) setCartonPrompt(null);
      if (response.preparation) accept(response.preparation,true);
      if (operation === "scan" && response.preparation) {
        const saved = response.preparation.state.scans.find(
          (item) => item.id === body.eventId,
        );
        if (saved) {
          response.scan ||= {
            code: saved.code,
            quantity: saved.quantity,
            wrong: !response.preparation.source.lines.some(
              (item) => item.code === saved.code,
            ),
          };
          const destination = response.preparation.state.packages.find(
            (item) => item.id === saved.packageId,
          );
          setActivePallet(destination.palletId || "");
          if (saved.mode === "carton" && !response.scan.wrong) {
            const next = {
              id: crypto.randomUUID(),
              number:
                Math.max(
                  0,
                  ...response.preparation.state.packages.map(
                    (item) => item.number,
                  ),
                ) + 1,
              palletId: destination.palletId,
            };
            setDraftPackage(next);
            setActivePackage(next.id);
          } else setActivePackage(saved.packageId);
        }
      }
      if (operation === "add_pallet" && response.preparation) {
        const destination = response.preparation.state.packages.find(
          (item) =>
            item.palletId === body.palletId &&
            !response.preparation.state.scans.some(
              (scan) => scan.packageId === item.id,
            ),
        );
        setActivePallet(body.palletId);
        if (destination) setActivePackage(destination.id);
        else {
          const next = {
            id: crypto.randomUUID(),
            number:
              Math.max(
                0,
                ...response.preparation.state.packages.map(
                  (item) => item.number,
                ),
              ) + 1,
            palletId: body.palletId,
          };
          setDraftPackage(next);
          setActivePackage(next.id);
        }
      }

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
      return { error: e.message, status: e.status };
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
      ...(draftPackage?.id === activePackage
        ? { createPackage: true, palletId: draftPackage.palletId }
        : {}),
    });
    if (!camera && !response?.requiresCartonPieces) input.current?.focus();
    return response;
  };

  const editable =
    canWrite && row && ["draft", "verified"].includes(row.status);

  const comparison = row ? comparePacking(row.source.lines, row.state) : null;

  const source = row?.source,
    scans = row?.state.scans || [],
    packages = row?.state.packages || [],
    pallets = row?.state.pallets || [];
  const visiblePackages =
    draftPackage && !packages.some((item) => item.id === draftPackage.id)
      ? [...packages, draftPackage]
      : packages;
  function choosePackage(item) {
    setActivePackage(item.id);
    setActivePallet(item.palletId || "");
    if (item.id !== draftPackage?.id) setDraftPackage(null);
  }
  function newDraftPackage(palletId) {
    const next = {
      id: crypto.randomUUID(),
      number: Math.max(0, ...packages.map((item) => item.number)) + 1,
      palletId,
    };
    setDraftPackage(next);
    setActivePackage(next.id);
    setActivePallet(palletId);
  }
  function choosePallet(item) {
    const empty = packages.find(
      (p) =>
        p.palletId === item.id &&
        !scans.some((scan) => scan.packageId === p.id),
    );
    if (empty) choosePackage(empty);
    else newDraftPackage(item.id);
  }

  const totalPieces = scans.reduce((n, s) => n + s.quantity, 0),
    totalExpected = source?.lines.reduce((n, l) => n + l.quantity, 0) || 0;

  const prepared = (order) =>
    history.find(
      (h) =>
        h.source.reference === order.reference && h.source.year === order.year,
    );

  const scanPanel=editable ? <button className="op-primary op-open-scanner" disabled={busy || !!pending} onClick={()=>setCamera(true)}><Camera size={18}/> Scansiona prodotti</button> : null;
  const renderPackage = (p) => (
    <article
      key={p.id}
      className={p.id === activePackage ? "op-package active" : "op-package"}
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

      {p.id !== draftPackage?.id && (
        <label>
          Bancale
          <select
            value={p.palletId || ""}
            disabled={!editable || busy || !!cartonPrompt}
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
      )}

      <ul>
        {[
          ...new Set(
            scans.filter((s) => s.packageId === p.id).map((s) => s.code),
          ),
        ].map((code) => (
          <li key={code}>
            {code}{" "}
            <strong>
              {format(
                scans
                  .filter((s) => s.packageId === p.id && s.code === code)
                  .reduce((n, s) => n + s.quantity, 0),
              )}{" "}
              pz
            </strong>
          </li>
        ))}
      </ul>

      {editable && (
        <div className="op-toolbar op-package-actions">
          <button
            disabled={busy || !!cartonPrompt}
            onClick={() => choosePackage(p)}
          >
            Usa questo collo
          </button>
          <button
            disabled={busy || scans.some((s) => s.packageId === p.id)}
            onClick={() =>
              p.id === draftPackage?.id
                ? (setDraftPackage(null),
                  setActivePackage(
                    packages.find((item) => item.palletId === p.palletId)?.id ||
                      "",
                  ))
                : void perform("remove_package", { packageId: p.id })
            }
          >
            Rimuovi vuoto
          </button>
        </div>
      )}
    </article>
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

          <section className="op-panel op-pallets-panel">
            <div className="op-pallets-heading">
              <h2>Bancali</h2>
              {editable && (
                <button
                  disabled={busy || !!cartonPrompt}
                  onClick={() =>
                    void perform("add_pallet", {
                      palletId: crypto.randomUUID(),
                      assignUnassigned: pallets.length === 0,
                    })
                  }
                >
                  <Truck size={16} /> Nuovo bancale
                </button>
              )}
            </div>
            {pallets.length === 0 && (
              <p>Crea un bancale per iniziare la scansione dei prodotti.</p>
            )}
            <div className="op-pallet-cards">
              {pallets.map((b) => (
                <article
                  key={b.id}
                  className={`op-pallet-card${b.id === activePallet ? " active" : ""}`}
                >
                  <div className="op-toolbar">
                    <h3>Bancale {b.number}</h3>
                    <span>
                      {
                        packages.filter(
                          (p) =>
                            p.palletId === b.id &&
                            scans.some((scan) => scan.packageId === p.id),
                        ).length
                      }{" "}
                      {packages.filter(
                        (p) =>
                          p.palletId === b.id &&
                          scans.some((scan) => scan.packageId === p.id),
                      ).length === 1
                        ? "collo"
                        : "colli"}
                    </span>
                    {editable && (
                      <>
                        {activePallet !== b.id && (
                          <button
                            disabled={busy || !!cartonPrompt}
                            onClick={() => choosePallet(b)}
                          >
                            Scansiona su questo bancale
                          </button>
                        )}
                        <button
                          disabled={busy || !!cartonPrompt}
                          onClick={() => newDraftPackage(b.id)}
                        >
                          <Package size={16} /> Nuovo collo
                        </button>
                        <button
                          disabled={
                            busy || packages.some((p) => p.palletId === b.id)
                          }
                          onClick={() =>
                            void perform("remove_pallet", { palletId: b.id })
                          }
                        >
                          Rimuovi vuoto
                        </button>
                      </>
                    )}
                  </div>
                  {b.id === activePallet && scanPanel}
                  <div className="op-package-grid">
                    {visiblePackages
                      .filter((p) => p.palletId === b.id)
                      .map(renderPackage)}
                  </div>
                </article>
              ))}
            </div>
            {packages.some((p) => !p.palletId) && (
              <div className="op-unassigned-packages">
                <h3>Colli da assegnare a un bancale</h3>
                <div className="op-package-grid">
                  {packages.filter((p) => !p.palletId).map(renderPackage)}
                </div>
              </div>
            )}
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
                    onClick={() => {
                      setDdtNotes(cleanWarehouseHandoffNote(source.note));
                      setConfirmDdt(true);
                    }}
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
                <h3>Conferma emissione BCS su Mexal</h3>
                <p>
                  OCM {source.series}/{source.number} · {source.customerName} ·{" "}
                  {totalPieces} pezzi · {packages.length} colli ·{" "}
                  {pallets.length} bancali.
                </p>
                <p>
                  La BCS evaderà l’OCM e movimenterà i lotti confermati. La
                  causale dell’ordine resta invariata.
                </p>
                <label>
                  Note della BCS
                  <textarea
                    value={ddtNotes}
                    onChange={(e) => setDdtNotes(e.target.value)}
                    rows={4}
                    maxLength={1000}
                    disabled={busy}
                    placeholder="Inserisci le note da riportare sul documento"
                  />
                </label>
                <small>
                  Rimosso il testo di consegna al magazzino. Puoi modificare o
                  aggiungere le note prima della conferma.
                </small>
                <button disabled={busy} onClick={() => setConfirmDdt(false)}>
                  Indietro
                </button>
                <button
                  className="op-primary"
                  disabled={busy}
                  onClick={() =>
                    void perform("export", { confirmedLots, ddtNotes })
                  }
                >
                  Conferma e crea BCS
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

          {editable && <BarcodeCamera
            enabled={camera}
            onRead={scan}
            onResolve={async barcode=>(await preparationApi("resolve_product",{id:row.id,barcode})).product}
            onClose={()=>setCamera(false)}
            paused={busy || !!pending}
            cartonPrompt={cartonPrompt} cartonPieces={cartonPieces} onCartonPieces={setCartonPieces}
            onSaveCarton={()=>perform("scan",{},{...cartonPrompt.body,piecesPerCarton:Number(cartonPieces)})}
            onCancelCarton={()=>setCartonPrompt(null)}
            mode={mode} onModeChange={setMode}
            pallets={pallets} activePallet={activePallet} onPalletChange={id=>choosePallet(pallets.find(item=>item.id===id))}
            packages={visiblePackages.filter(item=>item.palletId===activePallet)} activePackage={activePackage} onPackageChange={id=>choosePackage(visiblePackages.find(item=>item.id===id))}
            onNewPallet={()=>perform("add_pallet",{palletId:crypto.randomUUID(),assignUnassigned:pallets.length===0})}
            onNewPackage={()=>newDraftPackage(activePallet)}
            contextLabel={`Bancale ${pallets.find(item=>item.id===activePallet)?.number || "—"} · Collo ${visiblePackages.find(item=>item.id===activePackage)?.number || "—"}`}
          />}

          <section className="op-panel">
            <h2>Prodotti dell’ordine</h2>
            <div className="op-order-products-heading" aria-hidden="true"><span>Codice IT</span><span>Richiesti</span><span>Letti</span><span>Mancanti</span></div>
            <div className="op-order-products">{[...new Set(source.lines.map(item=>item.code))].map(code=>{
              const line=source.lines.find(item=>item.code===code),expected=source.lines.filter(item=>item.code===code).reduce((n,item)=>n+item.quantity,0),actual=scans.filter(item=>item.code===code).reduce((n,item)=>n+item.quantity,0);
              const lastCarton=scans.findLast(item=>item.code===code && item.mode==="carton" && item.specificationVersion),pieces=lastCarton?.quantity || line.piecesPerCarton,revision=lastCarton?.specificationVersion || line.packagingSpecificationVersion;
              return <details key={code} className="op-order-product"><summary aria-label={`${code}: richiesti ${expected}, letti ${actual}, mancanti ${Math.max(0,expected-actual)}`}><strong>{code}</strong><span>{format(expected)}</span><span className={actual>expected?"op-bad":actual===expected?"op-good":""}>{format(actual)}</span><span>{format(Math.max(0,expected-actual))}</span></summary>
                <div className="op-order-product-details"><strong>{line.description}</strong><span>Barcode: {line.barcode || "Da configurare"}</span><span>{pieces ? `${format(pieces)} pezzi/cartone${revision?` — Capitolato rev. ${revision}`:""}` : "Pezzi per cartone da compilare nel capitolato prodotto"}</span>{actual>expected && <span className="op-bad">In pi—: {format(actual-expected)} pezzi</span>}</div>
              </details>;
            })}</div>
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
                {source.fifoIssue && source.fifoDiagnostics && <details><summary>Dettagli disponibilità lotti</summary>
                  {source.fifoDiagnostics.lines.map(item=><p key={`${item.code}:${item.warehouse}`}>{item.code} · Magazzino {item.warehouse} · Giacenza fisica: {format(item.physical)} · Gestione lotti: {item.lotRequired?"sì":"no"}</p>)}
                  <div className="op-table-wrap"><table data-column-controls="off"><thead><tr><th>Articolo</th><th>Lotto</th><th>Quantità</th><th>Stato</th><th>Caricato</th><th>Ingresso</th><th>Validità</th></tr></thead><tbody>{source.fifoDiagnostics.lots.map(item=><tr key={`${item.code}:${item.warehouse}:${item.lotId}`}><td>{item.code}</td><td>{item.lotCode || item.lotId || "Senza lotto"}</td><td>{format(item.quantity)}</td><td>{item.state || "—"}</td><td>{item.loaded || "—"}</td><td>{item.entryDate || "—"}</td><td>{item.expiry || "—"}</td></tr>)}</tbody></table></div>
                </details>}
                <LotTable
                  allocations={
                    row.verification?.allocations || source.fifoProposal || []
                  }
                />
              </section>
            )}

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

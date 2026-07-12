import { useEffect, useState } from "react";
import { supabase } from "../services/reportSupabase";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

const campiDisponibili = [
  { key: "mese", label: "Mese" },
  { key: "stato", label: "Stato giornata / richiesta" },
  { key: "farmacia", label: "Farmacia" },
  { key: "citta", label: "Città" },
  { key: "provincia", label: "Provincia" },
  { key: "beauty", label: "Beauty" },
  { key: "prodotto", label: "Prodotto" },
  { key: "categoria", label: "Categoria prodotto" },
  { key: "sottocategoria", label: "Sottocategoria prodotto" },
];

const valoriDisponibili = [
  { key: "fatturato", label: "Fatturato" },
  { key: "giornate", label: "Numero giornate" },
  { key: "pezzi", label: "Pezzi venduti" },
  { key: "clienti_intervistati", label: "Clienti intervistati" },
  { key: "clienti_acquistato", label: "Clienti acquistato" },
  { key: "conversione", label: "Conversione %" },
  { key: "nuove_aperture", label: "Nuove aperture" },
  { key: "richieste_contatto", label: "Richieste contatto" },
  {
    key: "conversione_contatto_giornata",
    label: "Conversione contatto → giornata %",
  },
  { key: "farmacia_top_performance", label: "Farmacia top €" },
  { key: "trend_mensile", label: "Trend mensile €" },
];

export default function Analisi({ utente }) {
  const [giornate, setGiornate] = useState([]);
  const [farmacie, setFarmacie] = useState([]);
  const [beauty, setBeauty] = useState([]);
  const [province, setProvince] = useState([]);
  const [vendite, setVendite] = useState([]);
  const [apertureContatti, setApertureContatti] = useState([]);
  const [caricamento, setCaricamento] = useState(true);
  const [erroreCaricamento, setErroreCaricamento] = useState("");

  const ruoloUtente = String(utente?.external_role || utente?.ruolo || "").toLowerCase();
  const beautyIdUtente = utente?.external_beauty_id || utente?.beauty_id || "";
  const agentIdUtente = utente?.external_agent_id || utente?.agent_id || "";

  const [dataDa, setDataDa] = useState("");
  const [dataA, setDataA] = useState("");
  const [provinciaFiltro, setProvinciaFiltro] = useState("");
  const [farmaciaFiltro, setFarmaciaFiltro] = useState("");
  const [beautyFiltro, setBeautyFiltro] = useState("");
  const [statoFiltro, setStatoFiltro] = useState("");
  const [ricerca, setRicerca] = useState("");

  const [righe, setRighe] = useState(["farmacia"]);
  const [colonne, setColonne] = useState(["mese"]);
  const [valori, setValori] = useState(["fatturato"]);

  useEffect(() => {
    impostaMeseCorrente();
  }, []);

  useEffect(() => {
    if (utente) caricaDati();
  }, [utente]);

  function impostaMeseCorrente() {
    const oggi = new Date();
    const inizio = new Date(oggi.getFullYear(), oggi.getMonth(), 1);
    const fine = new Date(oggi.getFullYear(), oggi.getMonth() + 1, 0);

    setDataDa(inizio.toISOString().split("T")[0]);
    setDataA(fine.toISOString().split("T")[0]);
  }

  async function caricaTutteFarmacie() {
    let tutte = [];
    let from = 0;
    const size = 1000;

    while (true) {
      const { data, error } = await supabase
        .from("farmacie")
        .select("*")
        .order("nome", { ascending: true })
        .range(from, from + size - 1);

      if (error) throw error;

      tutte = [...tutte, ...(data || [])];

      if (!data || data.length < size) break;

      from += size;
    }

    return tutte;
  }

  async function caricaDati() {
    setCaricamento(true);
    setErroreCaricamento("");

    try {
      const farmacieData = await caricaTutteFarmacie();

    const provinceRes = await supabase
      .from("province")
      .select("*")
      .order("nome");

    let beautyQuery = supabase
      .from("beauty_consultant")
      .select("*")
      .eq("attivo", true)
      .order("cognome");

    if (ruoloUtente === "beauty") {
      if (!beautyIdUtente) {
        throw new Error("Profilo Beauty non collegato correttamente a Gestione Farmacie.");
      }
      beautyQuery = beautyQuery.eq("id", beautyIdUtente);
    }

    if (ruoloUtente === "agent") {
      if (!agentIdUtente) {
        throw new Error("Profilo Agente non collegato correttamente a Gestione Farmacie.");
      }
      beautyQuery = beautyQuery.eq("agent_id", agentIdUtente);
    }

    const beautyRes = await beautyQuery;

    if (provinceRes.error) throw provinceRes.error;
    if (beautyRes.error) throw beautyRes.error;

    const beautyData = beautyRes.data || [];
    const beautyIdsAgent = beautyData.map((b) => b.id);

    let queryGiornate = supabase
      .from("giornate_promozionali")
      .select("*")
      .order("data", { ascending: true });

    if (ruoloUtente === "beauty") {
      queryGiornate = queryGiornate.eq("consultant_id", beautyIdUtente);
    }

    if (ruoloUtente === "agent") {
      if (beautyIdsAgent.length === 0) {
        setGiornate([]);
        setVendite([]);
        setApertureContatti([]);
        setFarmacie(farmacieData);
        setBeauty([]);
        setProvince(provinceRes.data || []);
        setCaricamento(false);
        return;
      }

      queryGiornate = queryGiornate.in("consultant_id", beautyIdsAgent);
    }

    const giornateRes = await queryGiornate;

    if (giornateRes.error) throw giornateRes.error;

    const giornateData = giornateRes.data || [];
    const ids = giornateData.map((g) => g.id);

    let venditeData = [];

    if (ids.length > 0) {
      const venditeRes = await supabase
        .from("vendite_prodotti")
        .select("*")
        .in("giornata_id", ids);

      if (venditeRes.error) throw venditeRes.error;

      venditeData = venditeRes.data || [];
    }

    const apertureRes = await supabase
      .from("aperture_contatti")
      .select("*")
      .order("created_at", { ascending: false });

    if (apertureRes.error) throw apertureRes.error;

    let apertureData = apertureRes.data || [];

    if (ruoloUtente === "beauty") {
      apertureData = apertureData.filter((a) => a.beauty_id === beautyIdUtente);
    }

    if (ruoloUtente === "agent") {
      apertureData = apertureData.filter((a) =>
        beautyIdsAgent.includes(a.beauty_id)
      );
    }

    setGiornate(giornateData);
    setFarmacie(farmacieData);
    setBeauty(beautyData);
    setProvince(provinceRes.data || []);
    setVendite(venditeData);
    setApertureContatti(apertureData);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Errore caricamento Analisi dati:", error);
      setErroreCaricamento(message);
      setGiornate([]);
      setVendite([]);
      setApertureContatti([]);
    } finally {
      setCaricamento(false);
    }
  }

  function getFarmacia(id) {
    return farmacie.find((f) => f.id === id);
  }

  function getProvincia(id) {
    return province.find((p) => p.id === id);
  }

  function getBeauty(id) {
    return beauty.find((b) => b.id === id);
  }

  function getMese(dataIso) {
    if (!dataIso) return "Non indicato";
    const [anno, mese] = dataIso.split("-");
    return `${mese}/${anno}`;
  }

  function getCampo(record, campo) {
    const farmacia = getFarmacia(record.farmacia_id);
    const provincia = getProvincia(farmacia?.provincia_id);
    const b = getBeauty(record.consultant_id || record.beauty_id);

    if (campo === "mese") return getMese(record.data);
    if (campo === "stato") return record.stato || "Non indicato";
    if (campo === "farmacia")
      return farmacia?.nome || record.farmacia_nome || "Non indicata";
    if (campo === "citta")
      return farmacia?.citta || record.farmacia_citta || "Non indicata";
    if (campo === "provincia") {
      if (provincia) return `${provincia.nome} (${provincia.sigla})`;
      return record.farmacia_provincia || "Non indicata";
    }
    if (campo === "beauty") {
      if (b) return `${b.cognome || ""} ${b.nome || ""}`.trim();
      return record.beauty_nome || record.consultant_nome_storico || "Non indicata";
    }
    if (campo === "prodotto") return record.nome_prodotto || "Non indicato";
    if (campo === "categoria")
      return record.categoria_prodotto || "Non indicata";
    if (campo === "sottocategoria")
      return record.sottocategoria_prodotto || "Non indicata";

    return "Non indicato";
  }

  function creaRecordAnalisi() {
    const records = [];

    giornate.forEach((g) => {
      const venditeGiornata = vendite.filter((v) => v.giornata_id === g.id);

      if (venditeGiornata.length === 0) {
        records.push({
          ...g,
          id_giornata: g.id,
          tipo_record: "giornata",
        });
      } else {
        venditeGiornata.forEach((v) => {
          records.push({
            ...g,
            ...v,
            id_giornata: g.id,
            tipo_record: "giornata",
          });
        });
      }
    });

    apertureContatti.forEach((a) => {
      records.push({
        ...a,
        id_apertura: a.id,
        tipo_record: "apertura_contatto",
        data: a.created_at ? a.created_at.split("T")[0] : "",
        consultant_id: a.beauty_id,
      });
    });

    return records;
  }

  const farmacieConGiornate = farmacie.filter(
    (f) =>
      giornate.some((g) => g.farmacia_id === f.id) ||
      apertureContatti.some((a) => a.farmacia_id === f.id)
  );

  const recordsFiltrati = creaRecordAnalisi().filter((r) => {
    const farmacia = getFarmacia(r.farmacia_id);
    const provincia = getProvincia(farmacia?.provincia_id);

    if (dataDa && r.data < dataDa) return false;
    if (dataA && r.data > dataA) return false;
    if (provinciaFiltro && farmacia?.provincia_id !== provinciaFiltro)
      return false;
    if (farmaciaFiltro && r.farmacia_id !== farmaciaFiltro) return false;
    if (beautyFiltro && (r.consultant_id || r.beauty_id) !== beautyFiltro)
      return false;
    if (statoFiltro && r.stato !== statoFiltro) return false;

    const testo = `
      ${farmacia?.nome || r.farmacia_nome || ""}
      ${farmacia?.citta || r.farmacia_citta || ""}
      ${provincia?.nome || r.farmacia_provincia || ""}
      ${getCampo(r, "beauty")}
      ${r.nome_prodotto || ""}
      ${r.categoria_prodotto || ""}
      ${r.sottocategoria_prodotto || ""}
      ${r.referente_nome || ""}
      ${r.referente_contatto || ""}
      ${r.stato || ""}
    `.toLowerCase();

    return testo.includes(ricerca.toLowerCase());
  });

  function aggiornaLista(setter, valore) {
    setter((lista) =>
      lista.includes(valore)
        ? lista.filter((x) => x !== valore)
        : [...lista, valore]
    );
  }

  function chiaveCampi(record, campi) {
    if (campi.length === 0) return "Totale";
    return campi.map((c) => getCampo(record, c)).join(" / ");
  }

  function getRecordsGiornataUnici(records) {
    const map = {};

    records
      .filter((r) => r.tipo_record === "giornata")
      .forEach((r) => {
        const id = r.id_giornata || r.id;
        if (!map[id]) map[id] = r;
      });

    return Object.values(map);
  }

  function getRecordsAperturaUnici(records) {
    const map = {};

    records
      .filter((r) => r.tipo_record === "apertura_contatto")
      .forEach((r) => {
        const id = r.id_apertura || r.id;
        if (!map[id]) map[id] = r;
      });

    return Object.values(map);
  }

  function calcolaValore(records, valore) {
    const giornateUniche = getRecordsGiornataUnici(records);
    const apertureUniche = getRecordsAperturaUnici(records);

    if (valore === "fatturato") {
      return giornateUniche.reduce(
        (tot, r) => tot + Number(r.fatturato_giornata || 0),
        0
      );
    }

    if (valore === "giornate") {
      return giornateUniche.length;
    }

    if (valore === "pezzi") {
      return records
        .filter((r) => r.tipo_record === "giornata")
        .reduce(
          (tot, r) =>
            tot + Number(r.quantita || r.numero_totale_pezzi_venduti || 0),
          0
        );
    }

    if (valore === "clienti_intervistati") {
      return giornateUniche.reduce(
        (tot, r) => tot + Number(r.clienti_intervistati || 0),
        0
      );
    }

    if (valore === "clienti_acquistato") {
      return giornateUniche.reduce(
        (tot, r) => tot + Number(r.clienti_acquistato || 0),
        0
      );
    }

    if (valore === "conversione") {
      const intervistati = giornateUniche.reduce(
        (tot, r) => tot + Number(r.clienti_intervistati || 0),
        0
      );

      const acquistato = giornateUniche.reduce(
        (tot, r) => tot + Number(r.clienti_acquistato || 0),
        0
      );

      return intervistati > 0 ? (acquistato / intervistati) * 100 : 0;
    }

    if (valore === "nuove_aperture") {
      return apertureUniche.filter((a) => a.nuova_apertura === true).length;
    }

    if (valore === "richieste_contatto") {
      return apertureUniche.filter((a) => a.richiesta_contatto === true).length;
    }

    if (valore === "conversione_contatto_giornata") {
      const richieste = apertureUniche.filter(
        (a) => a.richiesta_contatto === true
      ).length;

      const trasformate = apertureUniche.filter(
        (a) => a.richiesta_contatto === true && a.stato === "trasformata"
      ).length;

      return richieste > 0 ? (trasformate / richieste) * 100 : 0;
    }

    if (valore === "farmacia_top_performance") {
      const dati = {};

      giornateUniche.forEach((r) => {
        const nome = getCampo(r, "farmacia");
        dati[nome] = (dati[nome] || 0) + Number(r.fatturato_giornata || 0);
      });

      const valoriFarmacie = Object.values(dati);
      return valoriFarmacie.length > 0 ? Math.max(...valoriFarmacie) : 0;
    }

    if (valore === "trend_mensile") {
      return giornateUniche.reduce(
        (tot, r) => tot + Number(r.fatturato_giornata || 0),
        0
      );
    }

    return 0;
  }

  function creaPivot() {
    const righeMap = {};
    const colonneSet = new Set();

    recordsFiltrati.forEach((r) => {
      const riga = chiaveCampi(r, righe);
      const colonna = chiaveCampi(r, colonne);

      if (!righeMap[riga]) righeMap[riga] = {};
      if (!righeMap[riga][colonna]) righeMap[riga][colonna] = [];

      righeMap[riga][colonna].push(r);
      colonneSet.add(colonna);
    });

    const colonneArray = Array.from(colonneSet).sort();

    const righeArray = Object.entries(righeMap)
      .map(([nomeRiga, colonneObj]) => {
        const riga = { nomeRiga };

        colonneArray.forEach((colonna) => {
          valori.forEach((valore) => {
            const records = colonneObj[colonna] || [];
            riga[`${colonna}__${valore}`] = calcolaValore(records, valore);
          });
        });

        return riga;
      })
      .sort((a, b) => a.nomeRiga.localeCompare(b.nomeRiga));

    return { colonneArray, righeArray };
  }

  const pivot = creaPivot();

  function formatValore(valore, tipo) {
    if (
      tipo === "fatturato" ||
      tipo === "farmacia_top_performance" ||
      tipo === "trend_mensile"
    ) {
      return `€ ${Number(valore || 0).toFixed(2)}`;
    }

    if (
      tipo === "conversione" ||
      tipo === "conversione_contatto_giornata"
    ) {
      return `${Number(valore || 0).toFixed(1)}%`;
    }

    return Number(valore || 0).toFixed(0);
  }
  async function esportaPDF() {
    if (caricamento) {
      alert("Attendi il completamento del caricamento dei dati.");
      return;
    }

    if (erroreCaricamento) {
      alert(`Impossibile generare il report: ${erroreCaricamento}`);
      return;
    }

    if (recordsFiltrati.length === 0 || pivot.righeArray.length === 0) {
      alert("Non ci sono dati da esportare con i filtri selezionati.");
      return;
    }

    const doc = new jsPDF({ orientation: "landscape" });

    async function caricaLogo() {
      try {
        const response = await fetch("/logo.png");
        if (!response.ok) return null;
        const blob = await response.blob();

        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    }

    const logo = await caricaLogo();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    if (logo) {
      doc.addImage(logo, "PNG", 14, 10, 30, 30);
    }

    doc.setTextColor(45, 43, 40);
    doc.setFontSize(20);
    doc.text("Report Analisi Dati", pageWidth - 14, 23, { align: "right" });

    doc.setFontSize(11);
    doc.setTextColor(107, 100, 92);
    doc.text(`Periodo: ${formatDataReport(dataDa)} - ${formatDataReport(dataA)}`, pageWidth - 14, 31, { align: "right" });
    doc.text(`Record analizzati: ${recordsFiltrati.length}`, pageWidth - 14, 37, { align: "right" });

    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(0.5);
    doc.line(14, 45, pageWidth - 14, 45);

    const headers = [
      "Righe",
      ...pivot.colonneArray.flatMap((colonna) =>
        valori.map((valore) => {
          const label = valoriDisponibili.find((item) => item.key === valore)?.label || valore;
          return `${colonna} - ${label}`;
        })
      ),
    ];

    const body = pivot.righeArray.map((riga) => [
      riga.nomeRiga,
      ...pivot.colonneArray.flatMap((colonna) =>
        valori.map((valore) =>
          formatValore(riga[`${colonna}__${valore}`], valore)
        )
      ),
    ]);

    autoTable(doc, {
      startY: 52,
      head: [headers],
      body,
      theme: "grid",
      styles: {
        fontSize: 8,
        textColor: [45, 43, 40],
        lineColor: [216, 209, 203],
        lineWidth: 0.2,
        cellPadding: 2.5,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [45, 43, 40],
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: [247, 245, 242] },
      margin: { left: 14, right: 14, bottom: 15 },
      didDrawPage: () => {
        const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
        doc.setFontSize(8);
        doc.setTextColor(107, 100, 92);
        doc.text(`Pagina ${currentPage}`, pageWidth - 14, pageHeight - 7, { align: "right" });
      },
    });

    doc.save("report-analisi-dati.pdf");
  }

  function formatDataReport(value) {
    if (!value) return "-";
    const [anno, mese, giorno] = value.split("-");
    return `${giorno}/${mese}/${anno}`;
  }

  function esportaExcel() {
    const workbook = XLSX.utils.book_new();

    const datiGrezzi = recordsFiltrati.map((r) => ({
      Tipo: r.tipo_record || "",
      Data: r.data || "",
      Mese: getCampo(r, "mese"),
      Stato: r.stato || "",
      Farmacia: getCampo(r, "farmacia"),
      Città: getCampo(r, "citta"),
      Provincia: getCampo(r, "provincia"),
      Beauty: getCampo(r, "beauty"),
      Prodotto: r.nome_prodotto || "",
      Categoria: r.categoria_prodotto || "",
      Sottocategoria: r.sottocategoria_prodotto || "",
      "Nuova apertura": r.nuova_apertura === true ? "Sì" : "No",
      "Richiesta contatto": r.richiesta_contatto === true ? "Sì" : "No",
      "Referente": r.referente_nome || "",
      "Contatto": r.referente_contatto || "",
      "Fatturato riga": Number(r.valore_totale || r.fatturato_giornata || 0),
      "Pezzi venduti": Number(r.quantita || r.numero_totale_pezzi_venduti || 0),
      "Clienti intervistati": Number(r.clienti_intervistati || 0),
      "Clienti acquistato": Number(r.clienti_acquistato || 0),
      "ID giornata": r.id_giornata || "",
      "ID apertura/contatto": r.id_apertura || "",
      "ID farmacia": r.farmacia_id || "",
      "ID beauty": r.consultant_id || r.beauty_id || "",
    }));

    const pivotHeaders = [
      "Righe",
      ...pivot.colonneArray.flatMap((colonna) =>
        valori.map((valore) => `${colonna} - ${valore}`)
      ),
    ];

    const pivotRows = pivot.righeArray.map((riga) => [
      riga.nomeRiga,
      ...pivot.colonneArray.flatMap((colonna) =>
        valori.map((valore) => riga[`${colonna}__${valore}`] || 0)
      ),
    ]);

    const datiPivot = [
      ["REPORT ANALISI DATI - PIVOT"],
      [`Periodo: ${dataDa || "-"} / ${dataA || "-"}`],
      [],
      pivotHeaders,
      ...pivotRows,
    ];

    const filtriApplicati = [
      ["Filtro", "Valore"],
      ["Data da", dataDa || "Tutte"],
      ["Data a", dataA || "Tutte"],
      [
        "Provincia",
        provinciaFiltro
          ? getProvincia(provinciaFiltro)?.nome || provinciaFiltro
          : "Tutte",
      ],
      [
        "Farmacia",
        farmaciaFiltro
          ? getFarmacia(farmaciaFiltro)?.nome || farmaciaFiltro
          : "Tutte",
      ],
      [
        "Beauty",
        beautyFiltro ? getCampo({ consultant_id: beautyFiltro }, "beauty") : "Tutte",
      ],
      ["Stato", statoFiltro || "Tutti"],
      ["Ricerca libera", ricerca || "-"],
      ["Righe pivot", righe.join(", ") || "Totale"],
      ["Colonne pivot", colonne.join(", ") || "Totale"],
      ["Valori pivot", valori.join(", ")],
      ["Record analizzati", recordsFiltrati.length],
    ];

    const wsGrezzi = XLSX.utils.json_to_sheet(datiGrezzi);
    const wsPivot = XLSX.utils.aoa_to_sheet(datiPivot);
    const wsFiltri = XLSX.utils.aoa_to_sheet(filtriApplicati);

    XLSX.utils.book_append_sheet(workbook, wsGrezzi, "Dati grezzi");
    XLSX.utils.book_append_sheet(workbook, wsPivot, "Pivot");
    XLSX.utils.book_append_sheet(workbook, wsFiltri, "Filtri applicati");

    XLSX.writeFile(workbook, "analisi_dati_completa.xlsx");
  }

  function CampoCheckbox({ title, lista, setter, tipo }) {
    const opzioni = tipo === "valori" ? valoriDisponibili : campiDisponibili;

    return (
      <div style={miniSectionStyle}>
        <h4>{title}</h4>

        {opzioni.map((c) => (
          <label key={c.key} style={checkStyle}>
  <span style={{ minWidth: "240px" }}>{c.label}</span>

  <input
    type="checkbox"
    checked={lista.includes(c.key)}
    onChange={() => aggiornaLista(setter, c.key)}
  />
</label>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div style={headerStyle}>
        <h2>Analisi Dati</h2>
        <p style={subtitleStyle}>
          Pivot avanzata con filtri, righe, colonne e valori personalizzabili
        </p>
      </div>

      {caricamento && (
        <div style={infoBoxStyle}>Caricamento dati in corso...</div>
      )}

      {erroreCaricamento && (
        <div style={errorBoxStyle}>Errore caricamento dati: {erroreCaricamento}</div>
      )}

      <div style={sectionStyle}>
        <h3>Filtri</h3>

        <div style={filtersStyle}>
          <label style={labelStyle}>Dal</label>
          <input
            style={inputStyle}
            type="date"
            value={dataDa}
            onChange={(e) => setDataDa(e.target.value)}
          />

          <label style={labelStyle}>Al</label>
          <input
            style={inputStyle}
            type="date"
            value={dataA}
            onChange={(e) => setDataA(e.target.value)}
          />

          <label style={labelStyle}>Provincia</label>
          <select
            style={inputStyle}
            value={provinciaFiltro}
            onChange={(e) => setProvinciaFiltro(e.target.value)}
          >
            <option value="">Tutte</option>
            {province.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome} ({p.sigla})
              </option>
            ))}
          </select>

          <label style={labelStyle}>Farmacia</label>
          <select
            style={inputStyle}
            value={farmaciaFiltro}
            onChange={(e) => setFarmaciaFiltro(e.target.value)}
          >
            <option value="">Tutte</option>
            {farmacieConGiornate.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome} {f.citta ? `- ${f.citta}` : ""}
              </option>
            ))}
          </select>

          {ruoloUtente === "admin" && (
            <>
              <label style={labelStyle}>Beauty</label>
              <select
                style={inputStyle}
                value={beautyFiltro}
                onChange={(e) => setBeautyFiltro(e.target.value)}
              >
                <option value="">Tutte</option>
                {beauty.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.cognome} {b.nome}
                  </option>
                ))}
              </select>
            </>
          )}

          <label style={labelStyle}>Stato</label>
          <select
            style={inputStyle}
            value={statoFiltro}
            onChange={(e) => setStatoFiltro(e.target.value)}
          >
            <option value="">Tutti</option>
            <option value="pianificata">Pianificata</option>
            <option value="eseguita">Eseguita</option>
            <option value="annullata">Annullata</option>
            <option value="aperta">Richiesta aperta</option>
            <option value="trasformata">Richiesta trasformata</option>
            <option value="evasa">Richiesta evasa</option>
          </select>

          <label style={labelStyle}>Ricerca libera</label>
          <input
            style={inputStyle}
            value={ricerca}
            onChange={(e) => setRicerca(e.target.value)}
            placeholder="Cerca farmacia, prodotto, città, beauty, referente..."
          />
        </div>
      </div>

      <div style={sectionStyle}>
        <h3>Configura pivot</h3>

        <div style={configGridStyle}>
          <CampoCheckbox title="Righe" lista={righe} setter={setRighe} />
          <CampoCheckbox title="Colonne" lista={colonne} setter={setColonne} />
          <CampoCheckbox
            title="Valori"
            lista={valori}
            setter={setValori}
            tipo="valori"
          />
        </div>
      </div>

      <div style={sectionStyle}>
        <button style={exportButtonStyle} onClick={esportaPDF} disabled={caricamento || !!erroreCaricamento || recordsFiltrati.length === 0}>
          ESPORTA PDF
        </button>

        <button style={excelButtonStyle} onClick={esportaExcel}>
          ESPORTA EXCEL COMPLETO
        </button>

        <h3>Risultato pivot</h3>

        <p style={subtitleStyle}>Record analizzati: {recordsFiltrati.length}</p>

        <div style={tableWrapperStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Righe</th>

                {pivot.colonneArray.map((colonna) =>
                  valori.map((valore) => (
                    <th key={`${colonna}_${valore}`} style={thStyle}>
                      {colonna}
                      <br />
                      {valoriDisponibili.find((v) => v.key === valore)?.label}
                    </th>
                  ))
                )}
              </tr>
            </thead>

            <tbody>
              {pivot.righeArray.length === 0 && (
                <tr>
                  <td style={tdStyle} colSpan="99">
                    Nessun dato disponibile
                  </td>
                </tr>
              )}

              {pivot.righeArray.map((riga) => (
                <tr key={riga.nomeRiga}>
                  <td style={tdStyle}>
                    <strong>{riga.nomeRiga}</strong>
                  </td>

                  {pivot.colonneArray.map((colonna) =>
                    valori.map((valore) => (
                      <td
                        key={`${riga.nomeRiga}_${colonna}_${valore}`}
                        style={tdStyle}
                      >
                        {formatValore(riga[`${colonna}__${valore}`], valore)}
                      </td>
                    ))
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const infoBoxStyle = {
  padding: "12px 14px",
  marginBottom: "14px",
  borderRadius: "12px",
  backgroundColor: "#EEF4FF",
  color: "#1E3A5F",
  fontWeight: "600",
};

const errorBoxStyle = {
  padding: "12px 14px",
  marginBottom: "14px",
  borderRadius: "12px",
  backgroundColor: "#FFF0F0",
  color: "#8B0000",
  fontWeight: "600",
};

const headerStyle = { textAlign: "center", marginBottom: "22px" };

const subtitleStyle = {
  fontSize: "14px",
  color: "#6B645C",
  marginTop: "6px",
};

const sectionStyle = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  padding: "18px",
  marginBottom: "22px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
  overflowX: "hidden",
};

const filtersStyle = {
  display: "grid",
  gap: "10px",
  width: "100%",
  maxWidth: "100%",
  overflow: "hidden",
};

const configGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "14px",
};

const miniSectionStyle = {
  padding: "14px",
  borderRadius: "14px",
  backgroundColor: "#F7F5F2",
  display: "flex",
  flexDirection: "column",
};

const inputStyle = {
  display: "block",
  width: "100%",
  maxWidth: "100%",
  minWidth: "0",
  boxSizing: "border-box",
  padding: "12px",
  borderRadius: "12px",
  border: "1px solid #D8D1CB",
  fontSize: "15px",
};

const labelStyle = {
  color: "#6B645C",
  fontWeight: "600",
};

const checkStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: "6px",
  marginBottom: "12px",
  fontSize: "14px",
  width: "100%",
};

const checkTextStyle = {
  display: "inline-block",
};

const tableWrapperStyle = {
  width: "100%",
  overflowX: "auto",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
};

const thStyle = {
  padding: "10px",
  border: "1px solid #D8D1CB",
  backgroundColor: "#2D2B28",
  color: "#FFFFFF",
  textAlign: "left",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "10px",
  border: "1px solid #D8D1CB",
  whiteSpace: "nowrap",
};

const exportButtonStyle = {
  width: "100%",
  padding: "14px",
  marginBottom: "18px",
  border: "1px solid #2D2B28",
  borderRadius: "14px",
  backgroundColor: "#2D2B28",
  color: "#FFFFFF",
  fontWeight: "600",
  cursor: "pointer",
};

const excelButtonStyle = {
  width: "100%",
  padding: "14px",
  marginBottom: "18px",
  border: "1px solid #6B645C",
  borderRadius: "14px",
  backgroundColor: "#6B645C",
  color: "#FFFFFF",
  fontWeight: "600",
  cursor: "pointer",
};

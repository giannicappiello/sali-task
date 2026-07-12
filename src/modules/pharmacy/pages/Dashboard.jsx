import { useEffect, useState } from "react";
import { supabase } from "../services/reportSupabase";
import * as XLSX from "xlsx";
import CompilaReport from "./CompilaReport.jsx";

import DashboardKpi from "../components/dashboard/DashboardKpi.jsx";
import DashboardFilters from "../components/dashboard/DashboardFilters.jsx";
import DashboardAreeAttenzione from "../components/dashboard/DashboardAreeAttenzione.jsx";
import DashboardObiettivi from "../components/dashboard/DashboardObiettivi.jsx";
import DashboardClassifiche from "../components/dashboard/DashboardClassifiche.jsx";
import DashboardSaturazione from "../components/dashboard/DashboardSaturazione.jsx";
import DashboardIncomplete from "../components/dashboard/DashboardIncomplete.jsx";
import DashboardFollowUp from "../components/dashboard/DashboardFollowUp.jsx";
import DashboardRichieste from "../components/dashboard/DashboardRichieste.jsx";

import {
  formatEuro,
  filtraGiornatePeriodo,
  filtraAperturePeriodo,
  calcolaKpiBase,
  calcolaKpiAperture,
} from "../utils/dashboardUtils";

export default function Dashboard({ utente }) {
  const [giornate, setGiornate] = useState([]);
  const [farmacie, setFarmacie] = useState([]);
  const [beauty, setBeauty] = useState([]);
  const [vendite, setVendite] = useState([]);
  const [followUp, setFollowUp] = useState([]);
  const [apertureContatti, setApertureContatti] = useState([]);

  const [dataDa, setDataDa] = useState("");
  const [dataA, setDataA] = useState("");
  const [farmaciaFiltro, setFarmaciaFiltro] = useState("");
  const [beautyFiltro, setBeautyFiltro] = useState("");

  const [mostraIncomplete, setMostraIncomplete] = useState(false);
  const [mostraFollowUpScaduti, setMostraFollowUpScaduti] = useState(false);
  const [mostraRichiesteContatto, setMostraRichiesteContatto] =
    useState(false);
  const [giornataReport, setGiornataReport] = useState(null);

  const [modalTrasforma, setModalTrasforma] = useState(false);
  const [modalEvasa, setModalEvasa] = useState(false);
  const [richiestaSelezionata, setRichiestaSelezionata] = useState(null);

  const [dataGiornata, setDataGiornata] = useState("");
  const [oraInizio, setOraInizio] = useState("");
  const [oraFine, setOraFine] = useState("");
  const [commentoEvasione, setCommentoEvasione] = useState("");

    useEffect(() => {
      impostaPeriodoMese();
    }, []);

    useEffect(() => {
      if (utente) caricaDati();
    }, [utente]);

  function impostaPeriodoMese() {
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
    let beautyIdsAgent = [];

    if (utente?.ruolo === "agent") {
      const beautyAgentRes = await supabase
        .from("beauty_consultant")
        .select("id")
        .eq("agent_id", utente.agent_id)
        .eq("attivo", true);

      if (beautyAgentRes.error) return alert(beautyAgentRes.error.message);

      beautyIdsAgent = (beautyAgentRes.data || []).map((b) => b.id);
    }

    let queryGiornate = supabase
      .from("giornate_promozionali")
      .select("*")
      .order("data", { ascending: true });

    if (utente?.ruolo === "beauty") {
      queryGiornate = queryGiornate.eq("consultant_id", utente.beauty_id);
    }

    if (utente?.ruolo === "agent") {
      if (beautyIdsAgent.length === 0) {
        setGiornate([]);
        setVendite([]);
        setFollowUp([]);
        setFarmacie([]);
        setBeauty([]);
        setApertureContatti([]);
        return;
      }

      queryGiornate = queryGiornate.in("consultant_id", beautyIdsAgent);
    }

    const giornateRes = await queryGiornate;
    const farmacieData = await caricaTutteFarmacie();

    let beautyQuery = supabase
      .from("beauty_consultant")
      .select("*")
      .eq("attivo", true)
      .order("cognome");

    if (utente?.ruolo === "beauty") {
      beautyQuery = beautyQuery.eq("id", utente.beauty_id);
    }

    if (utente?.ruolo === "agent") {
      beautyQuery = beautyQuery.eq("agent_id", utente.agent_id);
    }

    const beautyRes = await beautyQuery;

    if (giornateRes.error) return alert(giornateRes.error.message);
    if (beautyRes.error) return alert(beautyRes.error.message);

    const giornateData = giornateRes.data || [];
    const beautyData = beautyRes.data || [];

    setGiornate(giornateData);
    setFarmacie(farmacieData);
    setBeauty(beautyData);

    const ids = giornateData.map((g) => g.id);

    if (ids.length === 0) {
      setVendite([]);
      setFollowUp([]);
    } else {
      const venditeRes = await supabase
        .from("vendite_prodotti")
        .select("*")
        .in("giornata_id", ids);

      if (venditeRes.error) return alert(venditeRes.error.message);
      setVendite(venditeRes.data || []);

      const followUpRes = await supabase
        .from("follow_up_giornate")
        .select("*")
        .in("giornata_id", ids)
        .order("data_followup", { ascending: true });

      if (followUpRes.error) return alert(followUpRes.error.message);
      setFollowUp(followUpRes.data || []);
    }

    const apertureRes = await supabase
      .from("aperture_contatti")
      .select("*")
      .order("created_at", { ascending: false });

    if (apertureRes.error) return alert(apertureRes.error.message);

    let apertureData = apertureRes.data || [];

    if (utente?.ruolo === "beauty") {
      apertureData = apertureData.filter(
        (a) => a.beauty_id === utente.beauty_id
      );
    }

    if (utente?.ruolo === "agent") {
      const idsBeauty = beautyData.map((b) => b.id);
      apertureData = apertureData.filter((a) =>
        idsBeauty.includes(a.beauty_id)
      );
    }

    setApertureContatti(apertureData);
  }

  function getFarmacia(id) {
    return farmacie.find((f) => f.id === id);
  }

  function getFarmaciaNome(id) {
    return getFarmacia(id)?.nome || "Non indicata";
  }

  function getBeautyNome(id) {
    const b = beauty.find((item) => item.id === id);
    return b ? `${b.cognome || ""} ${b.nome || ""}`.trim() : "Non indicata";
  }

  const giornatePeriodo = filtraGiornatePeriodo(
    giornate,
    dataDa,
    dataA,
    farmaciaFiltro,
    beautyFiltro
  );

  const aperturePeriodo = filtraAperturePeriodo(
    apertureContatti,
    dataDa,
    dataA,
    farmaciaFiltro,
    beautyFiltro
  );

  const idsPeriodo = giornatePeriodo.map((g) => g.id);

  const venditePeriodo = vendite.filter((v) =>
    idsPeriodo.includes(v.giornata_id)
  );

  const oggi = new Date().toISOString().split("T")[0];

  const followUpPeriodo = followUp.filter((f) =>
    idsPeriodo.includes(f.giornata_id)
  );

  const followUpScaduti = followUpPeriodo.filter(
    (f) => f.data_followup && f.data_followup < oggi && f.stato !== "fatto"
  );

  const giornateSenzaReport = giornatePeriodo.filter(
    (g) => g.data < oggi && g.stato === "pianificata"
  );

  const {
    giornatePianificate,
    giornateEseguite,
    fatturatoPeriodo,
    pezziVenduti,
    conversione,
    mediaFatturato,
  } = calcolaKpiBase(giornatePeriodo);

  const {
    richiesteContattoAperte,
    nuoveAperturePeriodo,
    richiesteContattoPeriodo,
    richiesteContattoAperteNumero,
  } = calcolaKpiAperture(aperturePeriodo);

  const farmacieConGiornate = farmacie.filter(
    (f) =>
      giornate.some((g) => g.farmacia_id === f.id) ||
      apertureContatti.some((a) => a.farmacia_id === f.id)
  );

  const giornateConObiettivo = giornatePeriodo.filter(
    (g) => g.stato === "eseguita" && Number(g.obiettivo_vendite || 0) > 0
  );

  const totaleObiettivi = giornateConObiettivo.reduce(
    (tot, g) => tot + Number(g.obiettivo_vendite || 0),
    0
  );

  const fatturatoSuObiettivi = giornateConObiettivo.reduce(
    (tot, g) => tot + Number(g.fatturato_giornata || 0),
    0
  );

  const scostamentoTotale = fatturatoSuObiettivi - totaleObiettivi;

  const raggiungimentoObiettivi =
    totaleObiettivi > 0 ? (fatturatoSuObiettivi / totaleObiettivi) * 100 : 0;

  function calcolaObiettiviPerFarmacia() {
    const dati = {};

    giornateConObiettivo.forEach((g) => {
      const nome = getFarmaciaNome(g.farmacia_id);

      if (!dati[nome]) dati[nome] = { obiettivo: 0, fatturato: 0 };

      dati[nome].obiettivo += Number(g.obiettivo_vendite || 0);
      dati[nome].fatturato += Number(g.fatturato_giornata || 0);
    });

    return Object.entries(dati)
      .map(([nome, d]) => ({
        nome,
        obiettivo: d.obiettivo,
        fatturato: d.fatturato,
        scostamento: d.fatturato - d.obiettivo,
        raggiungimento:
          d.obiettivo > 0 ? (d.fatturato / d.obiettivo) * 100 : 0,
      }))
      .sort((a, b) => b.scostamento - a.scostamento);
  }

  function calcolaObiettiviPerBeauty() {
    const dati = {};

    giornateConObiettivo.forEach((g) => {
      const nome = getBeautyNome(g.consultant_id);

      if (!dati[nome]) dati[nome] = { obiettivo: 0, fatturato: 0 };

      dati[nome].obiettivo += Number(g.obiettivo_vendite || 0);
      dati[nome].fatturato += Number(g.fatturato_giornata || 0);
    });

    return Object.entries(dati)
      .map(([nome, d]) => ({
        nome,
        obiettivo: d.obiettivo,
        fatturato: d.fatturato,
        scostamento: d.fatturato - d.obiettivo,
        raggiungimento:
          d.obiettivo > 0 ? (d.fatturato / d.obiettivo) * 100 : 0,
      }))
      .sort((a, b) => b.scostamento - a.scostamento);
  }

  const obiettiviFarmacie = calcolaObiettiviPerFarmacia();
  const obiettiviBeauty = calcolaObiettiviPerBeauty();

  const farmacieSopraObiettivo = obiettiviFarmacie.filter(
    (x) => x.scostamento >= 0
  );
  const farmacieSottoObiettivo = obiettiviFarmacie.filter(
    (x) => x.scostamento < 0
  );
  const beautySopraObiettivo = obiettiviBeauty.filter(
    (x) => x.scostamento >= 0
  );
  const beautySottoObiettivo = obiettiviBeauty.filter(
    (x) => x.scostamento < 0
  );

  function calcolaTopBeauty() {
    const dati = {};

    giornatePeriodo.forEach((g) => {
      const nome = getBeautyNome(g.consultant_id);
      dati[nome] = (dati[nome] || 0) + Number(g.fatturato_giornata || 0);
    });

    return Object.entries(dati)
      .map(([nome, valore]) => ({ nome, valore }))
      .sort((a, b) => b.valore - a.valore);
  }

  function calcolaTopProdotti() {
    const dati = {};

    venditePeriodo.forEach((v) => {
      const nome = v.nome_prodotto || "Non indicato";
      dati[nome] = (dati[nome] || 0) + Number(v.quantita || 0);
    });

    return Object.entries(dati)
      .map(([nome, valore]) => ({ nome, valore }))
      .sort((a, b) => b.valore - a.valore);
  }

  function calcolaTopCategorie() {
    const dati = {};

    venditePeriodo.forEach((v) => {
      const categoria = v.categoria_prodotto || "Categoria non indicata";
      const sottocategoria =
        v.sottocategoria_prodotto || "Sottocategoria non indicata";
      const nome = `${categoria} / ${sottocategoria}`;

      dati[nome] = (dati[nome] || 0) + Number(v.quantita || 0);
    });

    return Object.entries(dati)
      .map(([nome, valore]) => ({ nome, valore }))
      .sort((a, b) => b.valore - a.valore);
  }

  const topBeauty = calcolaTopBeauty();
  const topProdotti = calcolaTopProdotti();
  const topCategorie = calcolaTopCategorie();

  function calcolaSaturazioneBeauty() {
    const dati = {};

    giornate
      .filter((g) => g.data >= oggi && g.stato === "pianificata")
      .forEach((g) => {
        const nome = getBeautyNome(g.consultant_id);
        dati[nome] = (dati[nome] || 0) + 1;
      });

    return Object.entries(dati)
      .map(([nome, giornate]) => ({ nome, giornate }))
      .sort((a, b) => b.giornate - a.giornate);
  }

  const saturazioneBeauty = calcolaSaturazioneBeauty();

  async function aggiornaFollowUpFatto(item) {
    const { error } = await supabase
      .from("follow_up_giornate")
      .update({ stato: "fatto" })
      .eq("id", item.id);

    if (error) return alert(error.message);
    await caricaDati();
  }

  async function rimandaFollowUp(item) {
    const nuovaData = window.prompt(
      "Inserisci nuova data follow-up nel formato YYYY-MM-DD",
      item.data_followup || ""
    );

    if (!nuovaData) return;

    const { error } = await supabase
      .from("follow_up_giornate")
      .update({
        stato: "rimandato",
        data_followup: nuovaData,
      })
      .eq("id", item.id);

    if (error) return alert(error.message);
    await caricaDati();
  }

function trasformaInGiornata(item) {
      setRichiestaSelezionata(item);
      setDataGiornata("");
      setOraInizio("");
      setOraFine("");
      setModalTrasforma(true);
}

function evadiRichiestaContatto(item) {
  setRichiestaSelezionata(item);
  setCommentoEvasione("");
  setModalEvasa(true);
}

function convertiData(dataIt) {
  const p = dataIt.split("/");

  if (p.length !== 3) return null;

  return `20${p[2]}-${p[1]}-${p[0]}`;
}

async function confermaTrasformazione() {
  const dataSql = convertiData(dataGiornata);

  if (!dataSql) {
    alert("Usa formato gg/mm/aa");
    return;
  }

  const { data, error } = await supabase
    .from("giornate_promozionali")
    .insert([
      {
        farmacia_id: richiestaSelezionata.farmacia_id,
        consultant_id: richiestaSelezionata.beauty_id,
        data: dataSql,
        ora_inizio: oraInizio,
        ora_fine: oraFine,
        stato: "pianificata",
      },
    ])
    .select()
    .single();

  if (error) return alert(error.message);

  await supabase
    .from("aperture_contatti")
    .update({
      stato: "trasformata",
      giornata_id: data.id,
    })
    .eq("id", richiestaSelezionata.id);

  setModalTrasforma(false);

  await caricaDati();
}

async function confermaEvasione() {
  if (!commentoEvasione) return;

  await supabase
    .from("aperture_contatti")
    .update({
      stato: "evasa",
      commento_evasione: commentoEvasione,
    })
    .eq("id", richiestaSelezionata.id);

  setModalEvasa(false);

  await caricaDati();
}  


  function esportaXLS(nomeFile, righe) {
    const worksheet = XLSX.utils.json_to_sheet(righe);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Dati");
    XLSX.writeFile(workbook, `${nomeFile}.xlsx`);
  }

  function esportaObiettivi(nomeFile, dati) {
    esportaXLS(
      nomeFile,
      dati.map((item) => ({
        Nome: item.nome,
        Obiettivo: Number(item.obiettivo || 0).toFixed(2),
        Fatturato: Number(item.fatturato || 0).toFixed(2),
        "Scostamento €": Number(item.scostamento || 0).toFixed(2),
        "Raggiungimento %": Number(item.raggiungimento || 0).toFixed(1),
      }))
    );
  }

  function esportaClassifica(nomeFile, dati, labelValore = "Valore") {
    esportaXLS(
      nomeFile,
      dati.map((item) => ({
        Nome: item.nome,
        [labelValore]: item.valore,
      }))
    );
  }

  if (giornataReport) {
    return (
      <CompilaReport
        giornata={giornataReport}
        farmacie={farmacie}
        beauty={beauty}
        onBack={async () => {
          setGiornataReport(null);
          await caricaDati();
        }}
      />
    );
  }

  if (mostraIncomplete) {
    return (
      <DashboardIncomplete
        giornateSenzaReport={giornateSenzaReport}
        getFarmaciaNome={getFarmaciaNome}
        getBeautyNome={getBeautyNome}
        setMostraIncomplete={setMostraIncomplete}
        setGiornataReport={setGiornataReport}
      />
    );
  }

  if (mostraFollowUpScaduti) {
    return (
      <DashboardFollowUp
        followUpScaduti={followUpScaduti}
        giornate={giornate}
        getFarmaciaNome={getFarmaciaNome}
        getBeautyNome={getBeautyNome}
        aggiornaFollowUpFatto={aggiornaFollowUpFatto}
        rimandaFollowUp={rimandaFollowUp}
        setMostraFollowUpScaduti={setMostraFollowUpScaduti}
      />
    );
  }

  if (mostraRichiesteContatto) {
  return (
    <>
      <DashboardRichieste
        richiesteContattoAperte={richiesteContattoAperte}
        getBeautyNome={getBeautyNome}
        trasformaInGiornata={trasformaInGiornata}
        evadiRichiestaContatto={evadiRichiestaContatto}
        setMostraRichiesteContatto={setMostraRichiesteContatto}
      />

      {modalTrasforma && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <h3>Trasforma in giornata</h3>

            <p>Inserisci data e orari</p>

            <input
              style={modalInputStyle}
              placeholder="Data gg/mm/aa"
              value={dataGiornata}
              onChange={(e) => setDataGiornata(e.target.value)}
            />

            <input
              type="time"
              style={modalInputStyle}
              value={oraInizio}
              onChange={(e) => setOraInizio(e.target.value)}
            />

            <input
              type="time"
              style={modalInputStyle}
              value={oraFine}
              onChange={(e) => setOraFine(e.target.value)}
            />

            <div style={modalButtonsStyle}>
              <button
                style={modalCancelButton}
                onClick={() => setModalTrasforma(false)}
              >
                Annulla
              </button>

              <button
                style={modalConfirmButton}
                onClick={confermaTrasformazione}
              >
                Conferma
              </button>
            </div>
          </div>
        </div>
      )}

      {modalEvasa && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <h3>Evasa con commento</h3>

            <textarea
              style={modalTextareaStyle}
              value={commentoEvasione}
              onChange={(e) => setCommentoEvasione(e.target.value)}
              placeholder="Inserisci commento..."
            />

            <div style={modalButtonsStyle}>
              <button
                style={modalCancelButton}
                onClick={() => setModalEvasa(false)}
              >
                Annulla
              </button>

              <button
                style={modalConfirmButton}
                onClick={confermaEvasione}
              >
                Conferma
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


  return (
    <div>
      <div style={headerStyle}>
        <h2>Dashboard</h2>
        <p style={subtitleStyle}>KPI e analisi dati giornate beauty</p>
      </div>

      <DashboardFilters
        dataDa={dataDa}
        dataA={dataA}
        setDataDa={setDataDa}
        setDataA={setDataA}
        farmaciaFiltro={farmaciaFiltro}
        setFarmaciaFiltro={setFarmaciaFiltro}
        beautyFiltro={beautyFiltro}
        setBeautyFiltro={setBeautyFiltro}
        farmacieConGiornate={farmacieConGiornate}
        beauty={beauty}
        utente={utente}
      />

      <DashboardKpi
        fatturatoPeriodo={fatturatoPeriodo}
        richiesteContattoPeriodo={richiesteContattoPeriodo}
        giornateEseguite={giornateEseguite}
        giornatePianificate={giornatePianificate}
        nuoveAperturePeriodo={nuoveAperturePeriodo}
        pezziVenduti={pezziVenduti}
        conversione={conversione}
        mediaFatturato={mediaFatturato}
      />

      <DashboardObiettivi
        raggiungimentoObiettivi={raggiungimentoObiettivi}
        totaleObiettivi={totaleObiettivi}
        fatturatoSuObiettivi={fatturatoSuObiettivi}
        scostamentoTotale={scostamentoTotale}
        farmacieSopraObiettivo={farmacieSopraObiettivo}
        farmacieSottoObiettivo={farmacieSottoObiettivo}
        beautySopraObiettivo={beautySopraObiettivo}
        beautySottoObiettivo={beautySottoObiettivo}
        esportaObiettivi={esportaObiettivi}
      />

      <DashboardClassifiche
        topBeauty={topBeauty}
        topProdotti={topProdotti}
        topCategorie={topCategorie}
        esportaClassifica={esportaClassifica}
      />

      <DashboardSaturazione saturazioneBeauty={saturazioneBeauty} />

      <DashboardAreeAttenzione
        giornateSenzaReport={giornateSenzaReport}
        followUpScaduti={followUpScaduti}
        richiesteContattoAperteNumero={richiesteContattoAperteNumero}
        setMostraIncomplete={setMostraIncomplete}
        setMostraFollowUpScaduti={setMostraFollowUpScaduti}
        setMostraRichiesteContatto={setMostraRichiesteContatto}
      />

            {modalTrasforma && (
        <div style={overlayStyle}>
          <div style={modalStyle}>

            <h3>Trasforma in giornata</h3>

            <p>Inserisci data e orari</p>

            <input
              style={modalInputStyle}
              placeholder="Data gg/mm/aa"
              value={dataGiornata}
              onChange={(e) => setDataGiornata(e.target.value)}
            />

            <input
              type="time"
              style={modalInputStyle}
              value={oraInizio}
              onChange={(e) => setOraInizio(e.target.value)}
            />

            <input
              type="time"
              style={modalInputStyle}
              value={oraFine}
              onChange={(e) => setOraFine(e.target.value)}
            />

            <div style={modalButtonsStyle}>
              <button
                style={modalCancelButton}
                onClick={() => setModalTrasforma(false)}
              >
                Annulla
              </button>

              <button
                style={modalConfirmButton}
                onClick={confermaTrasformazione}
              >
                Conferma
              </button>
            </div>

          </div>
        </div>
      )}

      {modalEvasa && (
        <div style={overlayStyle}>
          <div style={modalStyle}>

            <h3>Evasa con commento</h3>

            <textarea
              style={modalTextareaStyle}
              value={commentoEvasione}
              onChange={(e) => setCommentoEvasione(e.target.value)}
              placeholder="Inserisci commento..."
            />

            <div style={modalButtonsStyle}>
              <button
                style={modalCancelButton}
                onClick={() => setModalEvasa(false)}
              >
                Annulla
              </button>

              <button
                style={modalConfirmButton}
                onClick={confermaEvasione}
              >
                Conferma
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

const headerStyle = {
  textAlign: "center",
  marginBottom: "22px",
};

const subtitleStyle = {
  fontSize: "14px",
  color: "#6B645C",
  marginTop: "6px",
};

const overlayStyle = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0,0,0,0.45)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 9999,
};

const modalStyle = {
  width: "min(460px, 92vw)",
  backgroundColor: "#FFFFFF",
  padding: "28px",
  borderRadius: "18px",
  border: "1.5px solid #2D2B28",
};

const modalInputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "14px",
  marginBottom: "12px",
  borderRadius: "12px",
  border: "1px solid #D8D1CB",
  fontSize: "15px",
};

const modalTextareaStyle = {
  ...modalInputStyle,
  minHeight: "120px",
};

const modalButtonsStyle = {
  display: "flex",
  gap: "10px",
  marginTop: "14px",
};

const modalCancelButton = {
  flex: 1,
  padding: "12px",
  border: "1.5px solid #2D2B28",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  fontWeight: "600",
  cursor: "pointer",
};

const modalConfirmButton = {
  ...modalCancelButton,
  backgroundColor: "#2D2B28",
  color: "#FFFFFF",
};
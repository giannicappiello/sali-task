import { useEffect, useState } from "react";
import { supabase } from "../services/reportSupabase";
import CompilaReport from "./CompilaReport.jsx";
import SchedaFarmacia from "./SchedaFarmacia.jsx";
import FollowUpGiornata from "./FollowUpGiornata.jsx";
import AllegatiGiornata from "./AllegatiGiornata.jsx";

export default function Giornate({ utente }) {
  const [giornate, setGiornate] = useState([]);
  const [farmacie, setFarmacie] = useState([]);
  const [beauty, setBeauty] = useState([]);
  const [province, setProvince] = useState([]);

  const [mostraForm, setMostraForm] = useState(false);
  const [vistaPlanning, setVistaPlanning] = useState("mese");
  const [giornoSelezionato, setGiornoSelezionato] = useState(new Date());

  const [giornataInModifica, setGiornataInModifica] = useState(null);
  const [giornataDettaglio, setGiornataDettaglio] = useState(null);
  const [giornataReport, setGiornataReport] = useState(null);
  const [giornataAllegati, setGiornataAllegati] = useState(null);
  const [giornataFollowUp, setGiornataFollowUp] = useState(null);
  const [farmaciaScheda, setFarmaciaScheda] = useState(null);

  const [ricercaGiornate, setRicercaGiornate] = useState("");
  const [meseCalendario, setMeseCalendario] = useState(new Date());

  const [ricercaFarmacia, setRicercaFarmacia] = useState("");
  const [provinciaFiltro, setProvinciaFiltro] = useState("");

  const [farmaciaId, setFarmaciaId] = useState("");
  const [consultantId, setConsultantId] = useState("");
  const [data, setData] = useState("");
  const [oraInizio, setOraInizio] = useState("");
  const [oraFine, setOraFine] = useState("");
  const [tipoGiornata, setTipoGiornata] = useState("");
  const [obiettivoVendite, setObiettivoVendite] = useState("");
  const [noteOperative, setNoteOperative] = useState("");

  const ruoloUtente = utente?.external_role || utente?.ruolo || "";
  const beautyIdUtente =
    utente?.external_beauty_id || utente?.beauty_id || "";
  const agentIdUtente =
    utente?.external_agent_id || utente?.agent_id || "";

  const solaLettura =
    ruoloUtente === "agent" || ruoloUtente === "sales_manager";

  useEffect(() => {
    if (utente) caricaDati();
  }, [utente]);

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
        alert("Profilo Beauty non collegato correttamente a Gestione Farmacie.");
        setGiornate([]);
        setFarmacie(farmacieData);
        setProvince(provinceRes.data || []);
        setBeauty([]);
        return;
      }

      beautyQuery = beautyQuery.eq("id", beautyIdUtente);
    }

    if (ruoloUtente === "agent") {
      if (!agentIdUtente) {
        alert("Profilo Agente non collegato correttamente a Gestione Farmacie.");
        setGiornate([]);
        setFarmacie(farmacieData);
        setProvince(provinceRes.data || []);
        setBeauty([]);
        return;
      }

      beautyQuery = beautyQuery.eq("agent_id", agentIdUtente);
    }

    const beautyRes = await beautyQuery;

    if (provinceRes.error) return alert(provinceRes.error.message);
    if (beautyRes.error) return alert(beautyRes.error.message);

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
        setFarmacie(farmacieData);
        setProvince(provinceRes.data || []);
        setBeauty([]);
        return;
      }

      queryGiornate = queryGiornate.in("consultant_id", beautyIdsAgent);
    }

    const giornateRes = await queryGiornate;

    if (giornateRes.error) return alert(giornateRes.error.message);

    setGiornate(giornateRes.data || []);
    setFarmacie(farmacieData);
    setProvince(provinceRes.data || []);
    setBeauty(beautyData);
  }

  function formatDataIt(dataIso) {
    if (!dataIso) return "";
    const [anno, mese, giorno] = dataIso.split("-");
    return `${giorno}/${mese}/${anno.slice(2)}`;
  }

  function getDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function oggiKey() {
    return getDateKey(new Date());
  }

  function statoPlanning(giornata) {
    if (giornata.stato === "eseguita") return "effettuata";
    if (giornata.stato === "annullata") return "annullata";
    if (giornata.data < oggiKey() && giornata.stato === "pianificata")
      return "scaduta";
    return "pianificata";
  }

  function contaStati(eventi) {
  return {
    pianificate: eventi.filter((g) => statoPlanning(g) === "pianificata")
      .length,
    effettuate: eventi.filter((g) => statoPlanning(g) === "effettuata")
      .length,
    scadute: eventi.filter((g) => statoPlanning(g) === "scaduta").length,
    annullate: eventi.filter((g) => statoPlanning(g) === "annullata").length,
  };
}

  function getStatusCardStyle(giornata) {
    const stato = statoPlanning(giornata);

    if (stato === "effettuata") {
      return {
        ...cardStyle,
        border: "2px solid #1F4D3A",
        backgroundColor: "#EEF6F1",
      };
    }

    if (stato === "scaduta") {
      return {
        ...cardStyle,
        border: "2px solid #8B0000",
        backgroundColor: "#FFF0F0",
      };
    }

    if (stato === "annullata") {
      return {
        ...cardStyle,
        border: "2px solid #8A8178",
        backgroundColor: "#F2F2F2",
      };
    }

    return cardStyle;
  }

  function getStatusEventStyle(giornata) {
  const stato = statoPlanning(giornata);

  if (stato === "effettuata") {
    return {
      ...weekEventStyle,
      backgroundColor: "#00ac65",
    };
  }

  if (stato === "scaduta") {
    return {
      ...weekEventStyle,
      backgroundColor: "#f43b3b",
    };
  }

  if (stato === "annullata") {
    return {
      ...weekEventStyle,
      backgroundColor: "#8A8178",
    };
  }

  return {
    ...weekEventStyle,
    backgroundColor: "#5849fc",
  };
}

  function getCognomeBeauty(id) {
    const b = beauty.find((item) => item.id === id);
    return b?.cognome || getBeautyNome(id) || "-";
  }

  function getProvinciaLabel(id) {
    const p = province.find((provincia) => provincia.id === id);
    return p ? `${p.nome} (${p.sigla})` : "";
  }

  function getFarmacia(id) {
    return farmacie.find((farmacia) => farmacia.id === id);
  }

  function getFarmaciaLabel(id) {
    const f = getFarmacia(id);
    if (!f) return "";
    return `${f.nome} - ${f.citta || ""} ${getProvinciaLabel(f.provincia_id)}`;
  }

  function getBeautyNome(id) {
    const b = beauty.find((item) => item.id === id);
    return b ? `${b.cognome || ""} ${b.nome || ""}`.trim() : "";
  }

  const farmacieFiltrate = farmacie.filter((f) => {
    const provincia = getProvinciaLabel(f.provincia_id);
    const testo = `${f.nome || ""} ${f.citta || ""} ${provincia}`.toLowerCase();

    if (provinciaFiltro && f.provincia_id !== provinciaFiltro) return false;

    return testo.includes(ricercaFarmacia.toLowerCase());
  });

  const giornateFiltrate = giornate.filter((g) => {
    const farmacia = getFarmaciaLabel(g.farmacia_id);
    const beautyNome = getBeautyNome(g.consultant_id);
    const stato = statoPlanning(g);
    const testo = `${farmacia} ${beautyNome} ${g.stato || ""} ${stato} ${
      g.tipo_giornata || ""
    }`.toLowerCase();

    return testo.includes(ricercaGiornate.toLowerCase());
  });

  function cambiaMese(offset) {
    const nuovoMese = new Date(meseCalendario);
    nuovoMese.setMonth(nuovoMese.getMonth() + offset);
    setMeseCalendario(nuovoMese);
  }

  function cambiaSettimana(offset) {
    const nuovoGiorno = new Date(giornoSelezionato);
    nuovoGiorno.setDate(nuovoGiorno.getDate() + offset * 7);
    setGiornoSelezionato(nuovoGiorno);
  }

  function cambiaGiorno(offset) {
    const nuovoGiorno = new Date(giornoSelezionato);
    nuovoGiorno.setDate(nuovoGiorno.getDate() + offset);
    setGiornoSelezionato(nuovoGiorno);
  }

  function generaGiorniCalendario() {
    const anno = meseCalendario.getFullYear();
    const mese = meseCalendario.getMonth();

    const primoGiorno = new Date(anno, mese, 1);
    const ultimoGiorno = new Date(anno, mese + 1, 0);

    const offsetInizio = (primoGiorno.getDay() + 6) % 7;
    const giorni = [];

    for (let i = 0; i < offsetInizio; i++) giorni.push(null);

    for (let giorno = 1; giorno <= ultimoGiorno.getDate(); giorno++) {
      giorni.push(new Date(anno, mese, giorno));
    }

    return giorni;
  }

  function generaGiorniSettimana() {
    const base = new Date(giornoSelezionato);
    const day = (base.getDay() + 6) % 7;
    const lunedi = new Date(base);
    lunedi.setDate(base.getDate() - day);

    const giorni = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(lunedi);
      d.setDate(lunedi.getDate() + i);
      giorni.push(d);
    }

    return giorni;
  }

  function giornateDelGiorno(date) {
    const key = getDateKey(date);
    return giornateFiltrate.filter((g) => g.data === key);
  }

  function svuotaForm() {
    setFarmaciaId("");
    setConsultantId("");
    setData("");
    setOraInizio("");
    setOraFine("");
    setTipoGiornata("");
    setObiettivoVendite("");
    setNoteOperative("");
    setRicercaFarmacia("");
    setProvinciaFiltro("");
    setGiornataInModifica(null);
  }

  function apriNuovaGiornata() {
    svuotaForm();

    if (ruoloUtente === "beauty") {
      setConsultantId(beautyIdUtente);
    }

    setMostraForm(true);
    setGiornataDettaglio(null);
    setGiornataReport(null);
  }

  function modificaGiornata(giornata) {
    setGiornataInModifica(giornata);
    setFarmaciaId(giornata.farmacia_id || "");
    setConsultantId(giornata.consultant_id || "");
    setData(giornata.data || "");
    setOraInizio(giornata.ora_inizio || "");
    setOraFine(giornata.ora_fine || "");
    setTipoGiornata(giornata.tipo_giornata || "");
    setObiettivoVendite(giornata.obiettivo_vendite || "");
    setNoteOperative(giornata.note_operative || "");

    const farmacia = getFarmacia(giornata.farmacia_id);
    setProvinciaFiltro(farmacia?.provincia_id || "");

    setMostraForm(true);
    setGiornataDettaglio(null);
    setGiornataReport(null);
  }

  function tornaAlPlanning() {
    svuotaForm();
    setMostraForm(false);
    setGiornataDettaglio(null);
    setGiornataReport(null);
    setGiornataAllegati(null);
    setGiornataFollowUp(null);
    setFarmaciaScheda(null);
  }

  function apriDettaglio(giornata) {
    setGiornataDettaglio(giornata);
    setMostraForm(false);
    setGiornataReport(null);
  }

  function apriReport(giornata) {
    setGiornataReport(giornata);
    setMostraForm(false);
    setGiornataDettaglio(null);
  }

  function apriAllegati(giornata) {
    setGiornataAllegati(giornata);
    setMostraForm(false);
    setGiornataDettaglio(null);
    setGiornataReport(null);
  }

  async function salvaGiornata(e) {
    e.preventDefault();

    const datiGiornata = {
      farmacia_id: farmaciaId,
      consultant_id:
        ruoloUtente === "beauty" ? beautyIdUtente : consultantId,
      data,
      ora_inizio: oraInizio || null,
      ora_fine: oraFine || null,
      tipo_giornata: tipoGiornata,
      obiettivo_vendite: obiettivoVendite || null,
      note_operative: noteOperative,
      stato: giornataInModifica?.stato || "pianificata",
    };

    const response = giornataInModifica
      ? await supabase
          .from("giornate_promozionali")
          .update(datiGiornata)
          .eq("id", giornataInModifica.id)
      : await supabase.from("giornate_promozionali").insert([datiGiornata]);

    if (response.error) return alert(response.error.message);

    svuotaForm();
    setMostraForm(false);
    await caricaDati();
  }

  async function annullaGiornata(giornata) {
    const motivo = window.prompt("Inserisci il motivo dell'annullamento:");
    if (!motivo) return;

    const { error } = await supabase
      .from("giornate_promozionali")
      .update({
        stato: "annullata",
        motivo_annullamento: motivo,
      })
      .eq("id", giornata.id);

    if (error) return alert(error.message);

    await caricaDati();
  }

  async function eliminaGiornataDefinitiva(giornata) {
    const conferma = window.confirm(
      `Vuoi eliminare definitivamente la giornata del ${formatDataIt(
        giornata.data
      )}?`
    );

    if (!conferma) return;

    const { error } = await supabase
      .from("giornate_promozionali")
      .delete()
      .eq("id", giornata.id);

    if (error) return alert(error.message);

    await caricaDati();
  }

  if (giornataAllegati) {
    return (
      <AllegatiGiornata
        giornata={giornataAllegati}
        onBack={() => setGiornataAllegati(null)}
      />
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

  if (giornataFollowUp) {
    return (
      <FollowUpGiornata
        giornata={giornataFollowUp}
        farmacie={farmacie}
        beauty={beauty}
        onBack={async () => {
          setGiornataFollowUp(null);
          await caricaDati();
        }}
      />
    );
  }

  if (farmaciaScheda) {
    return (
      <SchedaFarmacia
        farmacia={farmaciaScheda}
        beauty={beauty}
        onBack={() => setFarmaciaScheda(null)}
      />
    );
  }

  const giorniCalendario = generaGiorniCalendario();
  const giorniSettimana = generaGiorniSettimana();
  const giornateGiornoSelezionato = giornateDelGiorno(giornoSelezionato);

  function azioniGiornata(giornata) {
    return (
      <div style={actionRowStyle}>
        {!solaLettura && (
          <>
            <button
              style={editButtonStyle}
              onClick={() => modificaGiornata(giornata)}
            >
              Modifica
            </button>

            {giornata.stato !== "annullata" && (
              <button
                style={reportButtonStyle}
                onClick={() => apriReport(giornata)}
              >
                {giornata.stato === "eseguita"
                  ? "Modifica report"
                  : "Compila report"}
              </button>
            )}

            {giornata.stato !== "annullata" && (
              <button
                style={deleteButtonStyle}
                onClick={() => annullaGiornata(giornata)}
              >
                Annulla
              </button>
            )}
          </>
        )}

        {ruoloUtente === "admin" && giornata.stato === "annullata" && (
          <button
            style={deleteButtonStyle}
            onClick={() => eliminaGiornataDefinitiva(giornata)}
          >
            Elimina definitivamente
          </button>
        )}

        {giornata.stato === "eseguita" && (
          <button style={reportButtonStyle} onClick={() => apriReport(giornata)}>
            Visualizza report
          </button>
        )}

        <button
          style={secondaryButtonStyle}
          onClick={() => apriAllegati(giornata)}
        >
          Allegati
        </button>

        <button
          style={secondaryButtonStyle}
          onClick={() => setGiornataFollowUp(giornata)}
        >
          Follow-up
        </button>

        <button
          style={secondaryButtonStyle}
          onClick={() =>
            setFarmaciaScheda(
              farmacie.find((f) => f.id === giornata.farmacia_id)
            )
          }
        >
          Scheda farmacia
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={headerStyle}>
        <h2>
          {mostraForm
            ? giornataInModifica
              ? "Modifica giornata"
              : "Nuova giornata"
            : giornataDettaglio
            ? "Dettaglio giornata"
            : "Planning"}
        </h2>
      </div>

      {mostraForm && (
        <div style={formWrapperStyle}>
          <form onSubmit={salvaGiornata} style={formStyle}>
            <button
              type="button"
              style={backButtonStyle}
              onClick={tornaAlPlanning}
            >
              ← Torna al planning
            </button>

            <label style={labelStyle}>Filtra farmacia per provincia</label>
            <select
              style={inputStyle}
              value={provinciaFiltro}
              onChange={(e) => {
                setProvinciaFiltro(e.target.value);
                setFarmaciaId("");
                setRicercaFarmacia("");
              }}
            >
              <option value="">Tutte le province</option>
              {province.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome} ({p.sigla})
                </option>
              ))}
            </select>

            <label style={labelStyle}>Cerca farmacia</label>
            <input
              style={inputStyle}
              placeholder="Nome farmacia, città o provincia..."
              value={ricercaFarmacia}
              onChange={(e) => setRicercaFarmacia(e.target.value)}
            />

            <label style={labelStyle}>Farmacia</label>
            <select
              style={inputStyle}
              value={farmaciaId}
              onChange={(e) => setFarmaciaId(e.target.value)}
              required
            >
              <option value="">Seleziona farmacia</option>
              {farmacieFiltrate.map((farmacia) => (
                <option key={farmacia.id} value={farmacia.id}>
                  {farmacia.nome} - {farmacia.citta}{" "}
                  {getProvinciaLabel(farmacia.provincia_id)}
                </option>
              ))}
            </select>

            {ruoloUtente === "admin" && (
              <>
                <label style={labelStyle}>Beauty consultant</label>
                <select
                  style={inputStyle}
                  value={consultantId}
                  onChange={(e) => setConsultantId(e.target.value)}
                  required
                >
                  <option value="">Seleziona beauty consultant</option>
                  {beauty.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.cognome} {b.nome}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label style={labelStyle}>Data</label>
            <input
              style={inputStyle}
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              required
            />

            <label style={labelStyle}>Ora inizio</label>
            <input
              style={inputStyle}
              type="time"
              value={oraInizio}
              onChange={(e) => setOraInizio(e.target.value)}
            />

            <label style={labelStyle}>Ora fine</label>
            <input
              style={inputStyle}
              type="time"
              value={oraFine}
              onChange={(e) => setOraFine(e.target.value)}
            />

            <label style={labelStyle}>Tipo giornata</label>
            <input
              style={inputStyle}
              placeholder="Tipo giornata"
              value={tipoGiornata}
              onChange={(e) => setTipoGiornata(e.target.value)}
            />

            <label style={labelStyle}>Obiettivo vendite €</label>
            <input
              style={inputStyle}
              type="number"
              placeholder="Obiettivo vendite €"
              value={obiettivoVendite}
              onChange={(e) => setObiettivoVendite(e.target.value)}
            />

            <label style={labelStyle}>Note operative</label>
            <textarea
              style={textareaStyle}
              placeholder="Note operative"
              value={noteOperative}
              onChange={(e) => setNoteOperative(e.target.value)}
            />

            <button style={saveButtonStyle} type="submit">
              {giornataInModifica ? "Aggiorna giornata" : "Salva giornata"}
            </button>
          </form>
        </div>
      )}

      {giornataDettaglio && (
        <div>
          <button
            type="button"
            style={backButtonStyle}
            onClick={tornaAlPlanning}
          >
            ← Torna al planning
          </button>

          <div style={getStatusCardStyle(giornataDettaglio)}>
            <h3>{getFarmaciaLabel(giornataDettaglio.farmacia_id)}</h3>

            <p>
              <span style={labelStyle}>Data:</span>{" "}
              {formatDataIt(giornataDettaglio.data)}
            </p>
            <p>
              <span style={labelStyle}>Beauty:</span>{" "}
              {getBeautyNome(giornataDettaglio.consultant_id)}
            </p>
            <p>
              <span style={labelStyle}>Orario:</span>{" "}
              {giornataDettaglio.ora_inizio || "--"} -{" "}
              {giornataDettaglio.ora_fine || "--"}
            </p>
            <p>
              <span style={labelStyle}>Tipo:</span>{" "}
              {giornataDettaglio.tipo_giornata || "--"}
            </p>
            <p>
              <span style={labelStyle}>Obiettivo:</span> €{" "}
              {giornataDettaglio.obiettivo_vendite || "0"}
            </p>
            <p>
              <span style={labelStyle}>Stato planning:</span>{" "}
              {statoPlanning(giornataDettaglio)}
            </p>

            {giornataDettaglio.motivo_annullamento && (
              <p>
                <span style={labelStyle}>Motivo annullamento:</span>{" "}
                {giornataDettaglio.motivo_annullamento}
              </p>
            )}

            {giornataDettaglio.note_operative && (
              <p>
                <span style={labelStyle}>Note operative:</span>{" "}
                {giornataDettaglio.note_operative}
              </p>
            )}

            {azioniGiornata(giornataDettaglio)}
          </div>
        </div>
      )}

      {!mostraForm && !giornataDettaglio && (
        <div>
          <div style={topControlsStyle}>
            {!solaLettura && (
              <button style={primaryButtonStyle} onClick={apriNuovaGiornata}>
                + Nuova giornata
              </button>
            )}

            <input
              style={inputStyle}
              placeholder="Ricerca rapida per farmacia, beauty, stato o tipo giornata..."
              value={ricercaGiornate}
              onChange={(e) => setRicercaGiornate(e.target.value)}
            />
          </div>

          <div style={legendStyle}>
            <span style={legendItemStyle}>
            <span style={{ ...legendDotStyle, backgroundColor: "#5849fc" }} />
              Pianificate
          </span>

          <span style={legendItemStyle}>
          <span style={{ ...legendDotStyle, backgroundColor: "#00ac65" }} />
          Effettuate
          </span>

          <span style={legendItemStyle}>
          <span style={{ ...legendDotStyle, backgroundColor: "#f43b3b" }} />
          Scadute
          </span>

          <span style={legendItemStyle}>
          <span style={{ ...legendDotStyle, backgroundColor: "#8A8178" }} />
        Annullate
        </span>
    </div>

          <div style={planningTabsStyle}>
            <button
              style={vistaPlanning === "mese" ? activeTabStyle : tabStyle}
              onClick={() => setVistaPlanning("mese")}
            >
              Mese
            </button>
            <button
              style={vistaPlanning === "settimana" ? activeTabStyle : tabStyle}
              onClick={() => setVistaPlanning("settimana")}
            >
              Settimana
            </button>
            <button
              style={vistaPlanning === "giorno" ? activeTabStyle : tabStyle}
              onClick={() => setVistaPlanning("giorno")}
            >
              Giorno
            </button>
          </div>

          {vistaPlanning === "mese" && (
            <div>
              <div style={calendarHeaderStyle}>
                <button style={smallButtonStyle} onClick={() => cambiaMese(-1)}>
                  ←
                </button>

                <h3>
                  {meseCalendario.toLocaleDateString("it-IT", {
                    month: "long",
                    year: "numeric",
                  })}
                </h3>

                <button style={smallButtonStyle} onClick={() => cambiaMese(1)}>
                  →
                </button>
              </div>

              <div style={weekHeaderStyle}>
                <div>Lun</div>
                <div>Mar</div>
                <div>Mer</div>
                <div>Gio</div>
                <div>Ven</div>
                <div>Sab</div>
                <div>Dom</div>
              </div>

              <div style={calendarGridStyle}>
                {giorniCalendario.map((giorno, index) => {
                  if (!giorno)
                    return <div key={index} style={emptyDayStyle}></div>;

                  const eventi = giornateDelGiorno(giorno);
                  const conteggi = contaStati(eventi);

                  return (
                    <button
                      key={index}
                      style={{
                        ...dayCellStyle,
                        ...(eventi.length > 0 ? highlightedDayStyle : {}),
                      }}
                      onClick={() => {
                        setGiornoSelezionato(giorno);
                        setVistaPlanning("giorno");
                      }}
                    >
                      <strong>{giorno.getDate()}</strong>

                      {eventi.length > 0 && (
                        <div style={monthStatsStyle}>
                          {conteggi.pianificate > 0 && (
                            <span style={plannedBadgeStyle}>
                              {conteggi.pianificate}
                            </span>
                          )}

                          {conteggi.effettuate > 0 && (
                            <span style={doneBadgeStyle}>
                               {conteggi.effettuate}
                            </span>
                          )}

                          {conteggi.scadute > 0 && (
                            <span style={expiredBadgeStyle}>
                               {conteggi.scadute}
                            </span>
                          )}

                          {conteggi.annullate > 0 && (
  <span style={cancelledBadgeStyle}>
    {conteggi.annullate}
  </span>
)}
                          
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {vistaPlanning === "settimana" && (
            <div>
              <div style={calendarHeaderStyle}>
                <button
                  style={smallButtonStyle}
                  onClick={() => cambiaSettimana(-1)}
                >
                  ←
                </button>

                <h3>Settimana</h3>

                <button
                  style={smallButtonStyle}
                  onClick={() => cambiaSettimana(1)}
                >
                  →
                </button>
              </div>

              <div style={weekGridStyle}>
                {giorniSettimana.map((giorno) => {
                  const eventi = giornateDelGiorno(giorno);
                  const conteggi = contaStati(eventi);

                  return (
                    <div key={getDateKey(giorno)} style={weekDayStyle}>
                      <h4>
                        {giorno.toLocaleDateString("it-IT", {
                          weekday: "short",
                        })}
                      </h4>

                      <strong>{formatDataIt(getDateKey(giorno))}</strong>

                      {eventi.length === 0 && (
                        <p style={emptyTextStyle}>Nessuna giornata</p>
                      )}

                      {eventi.length > 0 && (
                        <div style={weekStatsStyle}>
                          
                      

                      

                      
                        </div>
                      )}

                      {eventi.map((g) => (
                        <div
                          key={g.id}
                          style={getStatusEventStyle(g)}
                          onClick={() => apriDettaglio(g)}
                        >
                          <strong>{getCognomeBeauty(g.consultant_id)}</strong>
                        </div>
                      ))}
                    </div>
                  );
                })}

                <div style={emptyWeekSlotStyle}></div>
              </div>
            </div>
          )}

          {vistaPlanning === "giorno" && (
            <div>
              <div style={calendarHeaderStyle}>
                <button style={smallButtonStyle} onClick={() => cambiaGiorno(-1)}>
                  ←
                </button>

                <h3>{formatDataIt(getDateKey(giornoSelezionato))}</h3>

                <button style={smallButtonStyle} onClick={() => cambiaGiorno(1)}>
                  →
                </button>
              </div>

              <div style={listStyle}>
                {giornateGiornoSelezionato.length === 0 && (
                  <div style={cardStyle}>
                    Nessuna giornata organizzata in questo giorno.
                  </div>
                )}

                {giornateGiornoSelezionato.map((g) => (
                  <div key={g.id} style={getStatusCardStyle(g)}>
                    <h3>{getFarmaciaLabel(g.farmacia_id)}</h3>

                    <p>
                      <span style={labelStyle}>Beauty:</span>{" "}
                      {getBeautyNome(g.consultant_id)}
                    </p>

                    <p>
                      <span style={labelStyle}>Orario:</span>{" "}
                      {g.ora_inizio || "--"} - {g.ora_fine || "--"}
                    </p>

                    <p>
                      <span style={labelStyle}>Tipo:</span>{" "}
                      {g.tipo_giornata || "--"}
                    </p>

                    <p>
                      <span style={labelStyle}>Obiettivo:</span> €{" "}
                      {g.obiettivo_vendite || "0"}
                    </p>

                    <p>
                      <span style={labelStyle}>Stato planning:</span>{" "}
                      {statoPlanning(g)}
                    </p>

                    {azioniGiornata(g)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const headerStyle = { marginBottom: "22px", textAlign: "center" };

const topControlsStyle = {
  display: "grid",
  gap: "12px",
  marginBottom: "16px",
};

const primaryButtonStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "15px",
  marginBottom: "12px",
  border: "1px solid #6B645C",
  borderRadius: "16px",
  backgroundColor: "#6B645C",
  color: "#FFFFFF",
  fontSize: "16px",
  fontWeight: "600",
  cursor: "pointer",
};

const secondaryButtonStyle = {
  ...primaryButtonStyle,
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  border: "1.5px solid #2D2B28",
  marginBottom: "0",
};

const saveButtonStyle = {
  ...primaryButtonStyle,
  backgroundColor: "#2D2B28",
  border: "1px solid #2D2B28",
  marginBottom: 0,
};

const backButtonStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "13px",
  marginBottom: "14px",
  border: "1.5px solid #2D2B28",
  borderRadius: "14px",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  fontWeight: "600",
  cursor: "pointer",
};

const smallButtonStyle = {
  padding: "8px 14px",
  border: "1px solid #2D2B28",
  borderRadius: "10px",
  backgroundColor: "#FFFFFF",
  cursor: "pointer",
};

const formWrapperStyle = {
  width: "100%",
  maxWidth: "720px",
  margin: "0 auto",
  boxSizing: "border-box",
};

const formStyle = {
  width: "100%",
  boxSizing: "border-box",
  display: "grid",
  gap: "12px",
  padding: "20px",
  marginBottom: "24px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "14px",
  borderRadius: "12px",
  border: "1px solid #D8D1CB",
  fontSize: "15px",
};

const textareaStyle = {
  ...inputStyle,
  minHeight: "90px",
};

const listStyle = { display: "grid", gap: "16px" };

const cardStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "20px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
  lineHeight: "1.6",
};

const labelStyle = {
  color: "#6B645C",
  fontWeight: "600",
};

const actionRowStyle = {
  display: "flex",
  gap: "10px",
  marginTop: "16px",
  flexWrap: "wrap",
};

const editButtonStyle = {
  flex: 1,
  minWidth: "110px",
  padding: "10px 16px",
  border: "1px solid #B8ADA4",
  borderRadius: "12px",
  backgroundColor: "#F7F5F2",
  color: "#2D2B28",
  fontWeight: "600",
  cursor: "pointer",
};

const reportButtonStyle = {
  flex: 1,
  minWidth: "130px",
  padding: "10px 16px",
  border: "1px solid #2D2B28",
  borderRadius: "12px",
  backgroundColor: "#2D2B28",
  color: "#FFFFFF",
  fontWeight: "600",
  cursor: "pointer",
};

const deleteButtonStyle = {
  flex: 1,
  minWidth: "110px",
  padding: "10px 16px",
  border: "1px solid #8B0000",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  color: "#8B0000",
  fontWeight: "600",
  cursor: "pointer",
};

const planningTabsStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: "8px",
  marginBottom: "16px",
};

const tabStyle = {
  padding: "12px",
  borderRadius: "12px",
  border: "1px solid #D8D1CB",
  backgroundColor: "#FFFFFF",
  fontWeight: "600",
  cursor: "pointer",
};

const activeTabStyle = {
  ...tabStyle,
  backgroundColor: "#2D2B28",
  color: "#FFFFFF",
};

const legendStyle = {
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
  marginBottom: "14px",
  fontSize: "13px",
};

const legendItemStyle = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  color: "#2D2B28",
  fontWeight: "600",
};

const legendDotStyle = {
  width: "10px",
  height: "10px",
  borderRadius: "50%",
  display: "inline-block",
};

const calendarHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "14px",
};

const weekHeaderStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(7, 1fr)",
  textAlign: "center",
  fontWeight: "700",
  marginBottom: "8px",
  fontSize: "12px",
};

const calendarGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(7, 1fr)",
  gap: "6px",
};

const emptyDayStyle = {
  minHeight: "86px",
};

const dayCellStyle = {
  minHeight: "86px",
  padding: "6px",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  border: "1px solid #D8D1CB",
  fontSize: "12px",
  overflow: "hidden",
  cursor: "pointer",
  textAlign: "left",
};

const highlightedDayStyle = {
  border: "2px solid #2D2B28",
  backgroundColor: "#F7F5F2",
};

const monthStatsStyle = {
  display: "grid",
  gap: "4px",
  marginTop: "8px",
};

const weekStatsStyle = {
  display: "grid",
  gap: "4px",
  marginTop: "8px",
  marginBottom: "8px",
};

const plannedBadgeStyle = {
  display: "block",
  padding: "3px 5px",
  borderRadius: "7px",
  backgroundColor: "#5849fc",
  color: "#FFFFFF",
  fontSize: "10px",
  fontWeight: "700",
};

const doneBadgeStyle = {
  display: "block",
  padding: "3px 5px",
  borderRadius: "7px",
  backgroundColor: "#00ac65",
  color: "#FFFFFF",
  fontSize: "10px",
  fontWeight: "700",
};

const expiredBadgeStyle = {
  display: "block",
  padding: "3px 5px",
  borderRadius: "7px",
  backgroundColor: "#f43b3b",
  color: "#FFFFFF",
  fontSize: "10px",
  fontWeight: "700",
};

const cancelledBadgeStyle = {
  display: "block",
  padding: "3px 5px",
  borderRadius: "7px",
  backgroundColor: "#8A8178",
  color: "#FFFFFF",
  fontSize: "10px",
  fontWeight: "700",
};

const weekGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: "10px",
};

const weekDayStyle = {
  minHeight: "180px",
  padding: "10px",
  borderRadius: "14px",
  border: "1px solid #D8D1CB",
  backgroundColor: "#FFFFFF",
  fontSize: "12px",
  overflow: "hidden",
};

const emptyWeekSlotStyle = {
  minHeight: "180px",
};

const weekEventStyle = {
  padding: "8px",
  marginTop: "8px",
  borderRadius: "10px",
  backgroundColor: "#6B645C",
  color: "#FFFFFF",
  cursor: "pointer",
  lineHeight: "1.35",
  wordBreak: "break-word",
};

const emptyTextStyle = {
  color: "#8A8178",
  fontSize: "12px",
};
import { useEffect, useState } from "react";
import { supabase } from "../services/reportSupabase";

export default function ApertureContatti({ utente }) {
  const [farmacie, setFarmacie] = useState([]);
  const [beauty, setBeauty] = useState([]);
  const [province, setProvince] = useState([]);
  const [records, setRecords] = useState([]);
  const [giornate, setGiornate] = useState([]);

  const [mostraForm, setMostraForm] = useState(false);
  const [vistaPlanning, setVistaPlanning] = useState("mese");
  const [meseCalendario, setMeseCalendario] = useState(new Date());
  const [giornoSelezionato, setGiornoSelezionato] = useState(new Date());

  const [farmaciaId, setFarmaciaId] = useState("");
  const [beautyId, setBeautyId] = useState("");
  const [referenteNome, setReferenteNome] = useState("");
  const [referenteContatto, setReferenteContatto] = useState("");
  const [nuovaApertura, setNuovaApertura] = useState(false);
  const [richiestaContatto, setRichiestaContatto] = useState(false);
  const [ricercaFarmacia, setRicercaFarmacia] = useState("");
  const [ricercaRapida, setRicercaRapida] = useState("");

  const [modalTrasforma, setModalTrasforma] = useState(false);
  const [modalEvasa, setModalEvasa] = useState(false);
  const [recordSelezionato, setRecordSelezionato] = useState(null);
  const [dataTrasformazione, setDataTrasformazione] = useState("");
  const [commentoEvasione, setCommentoEvasione] = useState("");

  useEffect(() => {
    if (utente) caricaDati();
  }, [utente]);

  async function caricaDati() {
    const farmacieRes = await supabase
      .from("farmacie")
      .select("*")
      .order("nome", { ascending: true });

    const provinceRes = await supabase
      .from("province")
      .select("*")
      .order("nome", { ascending: true });

    let beautyQuery = supabase
      .from("beauty_consultant")
      .select("*")
      .eq("attivo", true)
      .order("cognome", { ascending: true });

    if (utente?.ruolo === "beauty") {
      beautyQuery = beautyQuery.eq("id", utente.beauty_id);
    }

    if (utente?.ruolo === "agent") {
      beautyQuery = beautyQuery.eq("agent_id", utente.agent_id);
    }

    const beautyRes = await beautyQuery;

    const recordsRes = await supabase
      .from("aperture_contatti")
      .select("*")
      .order("created_at", { ascending: false });

    const giornateRes = await supabase
      .from("giornate_promozionali")
      .select("id,data");

    if (farmacieRes.error) return alert(farmacieRes.error.message);
    if (provinceRes.error) return alert(provinceRes.error.message);
    if (beautyRes.error) return alert(beautyRes.error.message);
    if (recordsRes.error) return alert(recordsRes.error.message);
    if (giornateRes.error) return alert(giornateRes.error.message);

    const beautyData = beautyRes.data || [];
    let recordsData = recordsRes.data || [];

    if (utente?.ruolo === "admin" || utente?.ruolo === "sales_manager") {
      // vedono tutto
    } else if (utente?.ruolo === "agent") {
      const idsBeauty = beautyData.map((b) => b.id);

      recordsData = recordsData.filter(
        (r) => r.operatore_id === utente.id || idsBeauty.includes(r.beauty_id)
      );
    } else if (utente?.ruolo === "beauty") {
      recordsData = recordsData.filter((r) => r.operatore_id === utente.id);
    }

    setFarmacie(farmacieRes.data || []);
    setProvince(provinceRes.data || []);
    setBeauty(beautyData);
    setRecords(recordsData);
    setGiornate(giornateRes.data || []);

    if (utente?.ruolo === "beauty") {
      setBeautyId(utente.beauty_id || "");
    }
  }

  function getOperatoreNome() {
    return `${utente?.nome || ""} ${utente?.cognome || ""}`.trim();
  }

  function getDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function getCreatedDateKey(item) {
    return item.created_at ? item.created_at.split("T")[0] : "";
  }

  function formatDataIt(dataIso) {
    if (!dataIso) return "-";
    const [anno, mese, giorno] = dataIso.split("-");
    return `${giorno}/${mese}/${anno}`;
  }

  function formatDataOra(data) {
    if (!data) return "-";
    return new Date(data).toLocaleString("it-IT");
  }

  function getProvinciaLabel(id) {
    const p = province.find((x) => x.id === id);
    return p ? `${p.nome} (${p.sigla})` : "";
  }

  function getBeautyNome(id) {
    const b = beauty.find((x) => x.id === id);
    return b ? `${b.cognome || ""} ${b.nome || ""}`.trim() : "";
  }

  function getFarmacia(id) {
    return farmacie.find((f) => f.id === id);
  }

  function getFarmaciaLabel(f) {
    if (!f) return "";
    return `${f.nome || ""} - ${f.citta || ""} ${getProvinciaLabel(
      f.provincia_id
    )}`;
  }

  const recordsFiltrati = records.filter((r) => {
  const testo = `
    ${r.farmacia_nome || ""}
    ${r.farmacia_citta || ""}
    ${r.farmacia_provincia || ""}
    ${r.farmacia_indirizzo || ""}
    ${r.beauty_nome || ""}
    ${r.referente_nome || ""}
    ${r.referente_contatto || ""}
    ${r.operatore_nome || ""}
    ${r.stato || ""}
  `.toLowerCase();

  return testo.includes(ricercaRapida.toLowerCase());
});

  const farmacieFiltrate = farmacie.filter((f) => {
    const testo = `${f.nome || ""} ${f.citta || ""} ${
      f.indirizzo || ""
    } ${getProvinciaLabel(f.provincia_id)}`.toLowerCase();

    return testo.includes(ricercaFarmacia.toLowerCase());
  });

  function espandiRecord(record) {
    const eventi = [];

    if (record.nuova_apertura === true) {
      eventi.push({
        id: `${record.id}-apertura`,
        tipo: "apertura",
        colore: "yellow",
        label: "APERTURA",
        record,
      });
    }

    if (record.richiesta_contatto === true) {
      let colore = "red";

      if (record.stato === "trasformata") colore = "green";
      if (record.stato === "evasa") colore = "blue";

      eventi.push({
        id: `${record.id}-richiesta`,
        tipo: "richiesta",
        colore,
        label: "RICHIESTA",
        record,
      });
    }

    return eventi;
  }

  function eventiDelGiorno(date) {
    const key = getDateKey(date);
const recordsGiorno = recordsFiltrati.filter((r) => getCreatedDateKey(r) === key);
    return recordsGiorno.flatMap((r) => espandiRecord(r));
  }

  function contaEventi(giorno) {
    const eventi = eventiDelGiorno(giorno);

    return {
      aperture: eventi.filter((e) => e.colore === "yellow").length,
      richiesteAperte: eventi.filter((e) => e.colore === "red").length,
      trasformate: eventi.filter((e) => e.colore === "green").length,
      evase: eventi.filter((e) => e.colore === "blue").length,
    };
  }

  function getMiniStyle(colore) {
    if (colore === "yellow") {
      return { backgroundColor: "#F2C94C", color: "#2D2B28" };
    }

    if (colore === "red") {
      return { backgroundColor: "#8B0000", color: "#FFFFFF" };
    }

    if (colore === "green") {
      return { backgroundColor: "#8BC79A", color: "#1F3B25" };
    }

    if (colore === "blue") {
      return { backgroundColor: "#74B9D6", color: "#12313F" };
    }

    return {};
  }

  function generaGiorniCalendario() {
    const anno = meseCalendario.getFullYear();
    const mese = meseCalendario.getMonth();

    const primo = new Date(anno, mese, 1);
    const ultimo = new Date(anno, mese + 1, 0);
    const offset = (primo.getDay() + 6) % 7;

    const giorni = [];

    for (let i = 0; i < offset; i++) giorni.push(null);

    for (let d = 1; d <= ultimo.getDate(); d++) {
      giorni.push(new Date(anno, mese, d));
    }

    return giorni;
  }

  function generaSettimana() {
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

  function cambiaMese(offset) {
    const d = new Date(meseCalendario);
    d.setMonth(d.getMonth() + offset);
    setMeseCalendario(d);
  }

  function cambiaSettimana(offset) {
    const d = new Date(giornoSelezionato);
    d.setDate(d.getDate() + offset * 7);
    setGiornoSelezionato(d);
  }

  function cambiaGiorno(offset) {
    const d = new Date(giornoSelezionato);
    d.setDate(d.getDate() + offset);
    setGiornoSelezionato(d);
  }

  function resetForm() {
    setFarmaciaId("");
    setReferenteNome("");
    setReferenteContatto("");
    setNuovaApertura(false);
setRichiestaContatto(
  utente?.ruolo === "agent" || utente?.ruolo === "sales_manager"
);
    setRicercaFarmacia("");

    if (utente?.ruolo === "beauty") {
      setBeautyId(utente.beauty_id || "");
    } else {
      setBeautyId("");
    }
  }

  async function salvaAperturaContatto(e) {
    e.preventDefault();

    const farmacia = getFarmacia(farmaciaId);
    if (!farmacia) return alert("Seleziona una farmacia");
    if (!beautyId) return alert("Seleziona una beauty");
    if (!nuovaApertura && !richiestaContatto) {
      return alert("Seleziona almeno Nuova apertura o Richiesta di contatto");
    }

    const dati = {
      operatore_id: utente?.id || null,
      operatore_nome: getOperatoreNome(),

      beauty_id: beautyId,
      beauty_nome: getBeautyNome(beautyId),

      farmacia_id: farmacia.id,
      farmacia_nome: farmacia.nome || "",
      farmacia_citta: farmacia.citta || "",
      farmacia_provincia: getProvinciaLabel(farmacia.provincia_id),
      farmacia_indirizzo: farmacia.indirizzo || "",

      referente_nome: referenteNome,
      referente_contatto: referenteContatto,

      nuova_apertura: nuovaApertura,
      richiesta_contatto: richiestaContatto,

      stato: "aperta",
    };

    const { error } = await supabase.from("aperture_contatti").insert([dati]);

    if (error) return alert(error.message);

    resetForm();
    setMostraForm(false);
    await caricaDati();
  }

  function apriTrasformaModal(record) {
    setRecordSelezionato(record);
    setDataTrasformazione("");
    setModalTrasforma(true);
  }

  function apriEvasaModal(record) {
    setRecordSelezionato(record);
    setCommentoEvasione("");
    setModalEvasa(true);
  }

  async function confermaTrasformazione() {
    if (!recordSelezionato) return;

    if (!dataTrasformazione) {
      alert("Inserisci la data della giornata");
      return;
    }

    const { data: nuovaGiornata, error } = await supabase
      .from("giornate_promozionali")
      .insert([
        {
          farmacia_id: recordSelezionato.farmacia_id,
          consultant_id: recordSelezionato.beauty_id,
          data: dataTrasformazione,
          stato: "pianificata",
          tipo_giornata: "Richiesta contatto",
          note_operative: `Generata da richiesta contatto. Referente: ${
            recordSelezionato.referente_nome || "-"
          }. Contatto: ${recordSelezionato.referente_contatto || "-"}`,
        },
      ])
      .select()
      .single();

    if (error) return alert(error.message);

    const { error: updateError } = await supabase
      .from("aperture_contatti")
      .update({
        stato: "trasformata",
        giornata_id: nuovaGiornata.id,
      })
      .eq("id", recordSelezionato.id);

    if (updateError) return alert(updateError.message);

    setModalTrasforma(false);
    setRecordSelezionato(null);
    await caricaDati();
  }

  async function confermaEvasione() {
    if (!recordSelezionato) return;

    if (!commentoEvasione.trim()) {
      alert("Inserisci un commento");
      return;
    }

    const { error } = await supabase
      .from("aperture_contatti")
      .update({
        stato: "evasa",
        commento_evasione: commentoEvasione,
      })
      .eq("id", recordSelezionato.id);

    if (error) return alert(error.message);

    setModalEvasa(false);
    setRecordSelezionato(null);
    await caricaDati();
  }

  async function eliminaAperturaContatto(record) {
  if (utente?.ruolo !== "admin") return;

  const conferma = window.confirm(
    `Vuoi eliminare definitivamente questa apertura/richiesta?\n\nID: ${record.id}`
  );

  if (!conferma) return;

  const { data, error } = await supabase
    .from("aperture_contatti")
    .delete()
    .eq("id", record.id)
    .select();

  console.log("DELETE DATA", data);
  console.log("DELETE ERROR", error);

  if (error) {
    alert(error.message);
    return;
  }

  if (!data || data.length === 0) {
    alert("Nessun record eliminato. Probabile blocco RLS o ID non eliminabile.");
    return;
  }

  alert("Eliminazione eseguita");

  setRecords((prev) => prev.filter((r) => r.id !== record.id));
  setVistaPlanning("mese");

  await caricaDati();
}



  function renderLegenda() {
  return (
    <div style={legendStyle}>
      <span style={legendItemStyle}>
        <span style={{ ...legendDotStyle, backgroundColor: "#F2C94C" }} />
        Aperture
      </span>

      <span style={legendItemStyle}>
        <span style={{ ...legendDotStyle, backgroundColor: "#8B0000" }} />
        Richieste aperte
      </span>

      <span style={legendItemStyle}>
        <span style={{ ...legendDotStyle, backgroundColor: "#8BC79A" }} />
        Trasformate
      </span>

      <span style={legendItemStyle}>
        <span style={{ ...legendDotStyle, backgroundColor: "#74B9D6" }} />
        Evase
      </span>
    </div>
  );
}

  function renderEvento(evento) {
    return (
      <div
        key={evento.id}
        style={{
          ...eventoStyle,
          ...getMiniStyle(evento.colore),
        }}
      >
        <strong>{evento.label}</strong>
        <br />
        {evento.record.farmacia_nome}
      </div>
    );
  }

  function renderAzioniRichiesta(evento) {
    if (evento.tipo !== "richiesta") return null;
    if (evento.record.stato !== "aperta") return null;

    return (
      <div style={actionRowStyle}>
        <button
          style={reportButtonStyle}
          onClick={() => apriTrasformaModal(evento.record)}
        >
          Trasforma in giornata
        </button>

        <button
          style={secondaryButtonStyle}
          onClick={() => apriEvasaModal(evento.record)}
        >
          Evasa
        </button>
      </div>
    );
  }

  const giorniCalendario = generaGiorniCalendario();
  const settimana = generaSettimana();
  const eventiGiorno = eventiDelGiorno(giornoSelezionato);

  if (mostraForm) {
    return (
      <div>
        <div style={headerStyle}>
          <h2>Nuova Apertura / Richiesta</h2>
          <p style={subtitleStyle}>Compila i dati del contatto farmacia</p>
        </div>

        <button style={backButtonStyle} onClick={() => setMostraForm(false)}>
          ← Torna al planning
        </button>

        <form style={formStyle} onSubmit={salvaAperturaContatto}>
          <div style={checkContainer}>
            {utente?.ruolo !== "agent" && utente?.ruolo !== "sales_manager" && (
  <label style={checkStyle}>
    <input
      type="checkbox"
      checked={nuovaApertura}
      onChange={(e) => setNuovaApertura(e.target.checked)}
    />
    Nuova apertura
  </label>
)}

            <label style={checkStyle}>
  <input
    type="checkbox"
    checked={richiestaContatto}
    disabled={utente?.ruolo === "agent" || utente?.ruolo === "sales_manager"}
    onChange={(e) => setRichiestaContatto(e.target.checked)}
  />
  Richiesta di contatto
</label>
          </div>

          <label style={labelStyle}>Operatore</label>
          <input value={getOperatoreNome()} disabled style={inputStyle} />

          <label style={labelStyle}>Beauty di riferimento</label>
          <select
            value={beautyId}
            onChange={(e) => setBeautyId(e.target.value)}
            style={inputStyle}
            disabled={utente?.ruolo === "beauty"}
            required
          >
            <option value="">Seleziona beauty</option>
            {beauty.map((b) => (
              <option key={b.id} value={b.id}>
                {b.cognome} {b.nome}
              </option>
            ))}
          </select>

          <label style={labelStyle}>Cerca farmacia</label>
          <input
            style={inputStyle}
            placeholder="Cerca per nome, città, provincia o indirizzo..."
            value={ricercaFarmacia}
            onChange={(e) => setRicercaFarmacia(e.target.value)}
          />

          <label style={labelStyle}>Farmacia</label>
          <select
            value={farmaciaId}
            onChange={(e) => setFarmaciaId(e.target.value)}
            style={inputStyle}
            required
          >
            <option value="">Seleziona farmacia</option>
            {farmacieFiltrate.map((f) => (
              <option key={f.id} value={f.id}>
                {getFarmaciaLabel(f)}
              </option>
            ))}
          </select>

          <label style={labelStyle}>Nome referente farmacia</label>
          <input
            value={referenteNome}
            onChange={(e) => setReferenteNome(e.target.value)}
            style={inputStyle}
          />

          <label style={labelStyle}>Contatto referente farmacia</label>
          <input
            value={referenteContatto}
            onChange={(e) => setReferenteContatto(e.target.value)}
            style={inputStyle}
          />

          <button type="submit" style={saveButtonStyle}>
            Salva
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div style={headerStyle}>
        <h2>Aperture / Contatti</h2>
      </div>

      <button
  style={saveButtonStyle}
  onClick={() => {
    if (utente?.ruolo === "agent" || utente?.ruolo === "sales_manager") {
      setNuovaApertura(false);
      setRichiestaContatto(true);
    }

    setMostraForm(true);
  }}
>
  + Nuova Apertura / Richiesta
</button>

      {renderLegenda()}

      <input
  style={inputStyle}
  placeholder="Ricerca rapida per farmacia, beauty, referente, contatto, stato..."
  value={ricercaRapida}
  onChange={(e) => setRicercaRapida(e.target.value)}
/>

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
              if (!giorno) return <div key={index} style={emptyDayStyle}></div>;

              const conta = contaEventi(giorno);

              return (
                <div
                  key={index}
                  style={dayCellStyle}
                  onClick={() => {
                    setGiornoSelezionato(giorno);
                    setVistaPlanning("giorno");
                  }}
                >
                  <strong>{giorno.getDate()}</strong>

                  <div style={monthCounterContainer}>
                    {conta.aperture > 0 && (
                      <div style={monthYellow}>{conta.aperture}</div>
                    )}

                    {conta.richiesteAperte > 0 && (
                      <div style={monthRed}>{conta.richiesteAperte}</div>
                    )}

                    {conta.trasformate > 0 && (
                      <div style={monthGreen}>{conta.trasformate}</div>
                    )}

                    {conta.evase > 0 && (
                      <div style={monthBlue}>{conta.evase}</div>
                    )}
                  </div>
                </div>
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
            {settimana.map((giorno) => {
              const eventi = eventiDelGiorno(giorno);

              return (
                <div key={getDateKey(giorno)} style={weekDayStyle}>
                  <h4>
                    {giorno.toLocaleDateString("it-IT", { weekday: "short" })}
                  </h4>

                  <strong>{formatDataIt(getDateKey(giorno))}</strong>

                  {eventi.length === 0 && (
                    <p style={emptyTextStyle}>Nessun evento</p>
                  )}

                  {eventi.map((evento) => renderEvento(evento))}
                </div>
              );
            })}
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
            {eventiGiorno.length === 0 && (
              <div style={cardStyle}>Nessun evento</div>
            )}

            {eventiGiorno.map((evento) => (
              <div
                key={evento.id}
                style={{
                  ...cardStyle,
                  ...getMiniStyle(evento.colore),
                }}
              >
                <h3>{evento.label}</h3>

                <p>
                  <span style={labelStyle}>Farmacia:</span>{" "}
                  {evento.record.farmacia_nome}
                </p>

                <p>
                  <span style={labelStyle}>Beauty:</span>{" "}
                  {evento.record.beauty_nome}
                </p>

                <p>
                  <span style={labelStyle}>Inserito:</span>{" "}
                  {formatDataOra(evento.record.created_at)}
                </p>

                {evento.record.referente_nome && (
                  <p>
                    <span style={labelStyle}>Referente:</span>{" "}
                    {evento.record.referente_nome}
                  </p>
                )}

                {evento.record.referente_contatto && (
                  <p>
                    <span style={labelStyle}>Contatto:</span>{" "}
                    {evento.record.referente_contatto}
                  </p>
                )}

                {evento.tipo === "richiesta" && (
                  <p>
                    <span style={labelStyle}>Stato:</span>{" "}
                    {evento.record.stato}
                  </p>
                )}

                {evento.record.stato === "evasa" &&
                  evento.record.commento_evasione && (
                    <p>
                      <span style={labelStyle}>Commento evasione:</span>{" "}
                      {evento.record.commento_evasione}
                    </p>
                  )}

                {renderAzioniRichiesta(evento)}

                  {utente?.ruolo === "admin" && (
  <button
    style={deleteButtonStyle}
    onClick={() => eliminaAperturaContatto(evento.record)}
  >
    Elimina definitivamente
  </button>
)}

              </div>
            ))}
          </div>
        </div>
      )}

      {modalTrasforma && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <h3>Trasforma in giornata</h3>

            <p>Inserisci data giornata</p>

            <input
              type="date"
              value={dataTrasformazione}
              onChange={(e) => setDataTrasformazione(e.target.value)}
              style={inputStyle}
            />

            <div style={modalButtonsStyle}>
              <button
                style={secondaryButtonStyle}
                onClick={() => setModalTrasforma(false)}
              >
                Annulla
              </button>

              <button style={reportButtonStyle} onClick={confermaTrasformazione}>
                Conferma
              </button>
            </div>
          </div>
        </div>
      )}

      {modalEvasa && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <h3>Evadi richiesta</h3>

            <p>Inserisci commento</p>

            <textarea
              value={commentoEvasione}
              onChange={(e) => setCommentoEvasione(e.target.value)}
              style={textareaStyle}
            />

            <div style={modalButtonsStyle}>
              <button
                style={secondaryButtonStyle}
                onClick={() => setModalEvasa(false)}
              >
                Annulla
              </button>

              <button style={reportButtonStyle} onClick={confermaEvasione}>
                Conferma
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const headerStyle = { marginBottom: "22px", textAlign: "center" };

const subtitleStyle = {
  fontSize: "14px",
  color: "#6B645C",
  marginTop: "6px",
};

const labelStyle = {
  color: "#6B645C",
  fontWeight: "600",
};

const saveButtonStyle = {
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

const formStyle = {
  width: "100%",
  maxWidth: "720px",
  margin: "0 auto 24px auto",
  boxSizing: "border-box",
  display: "grid",
  gap: "12px",
  padding: "20px",
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
  marginBottom: "12px",
};

const textareaStyle = {
  ...inputStyle,
  minHeight: "90px",
};

const checkContainer = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: "80px",
  width: "100%",
  marginBottom: "18px",
};

const checkStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontWeight: "600",
  whiteSpace: "nowrap",
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

const smallButtonStyle = {
  padding: "8px 14px",
  border: "1px solid #2D2B28",
  borderRadius: "10px",
  backgroundColor: "#FFFFFF",
  cursor: "pointer",
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

const monthCounterContainer = {
  display: "grid",
  gap: "4px",
  marginTop: "8px",
};

const monthYellow = {
  display: "block",
  padding: "3px 5px",
  borderRadius: "7px",
  backgroundColor: "#F2C94C",
  color: "#2D2B28",
  fontSize: "10px",
  fontWeight: "700",
};

const monthRed = {
  ...monthYellow,
  backgroundColor: "#8B0000",
  color: "#FFFFFF",
};

const monthGreen = {
  ...monthYellow,
  backgroundColor: "#8BC79A",
  color: "#1F3B25",
};

const monthBlue = {
  ...monthYellow,
  backgroundColor: "#74B9D6",
  color: "#12313F",
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

const eventoStyle = {
  padding: "8px",
  marginTop: "8px",
  borderRadius: "10px",
  cursor: "pointer",
  lineHeight: "1.35",
  wordBreak: "break-word",
};

const listStyle = {
  display: "grid",
  gap: "16px",
};

const cardStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "20px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
  lineHeight: "1.6",
};

const emptyTextStyle = {
  color: "#8A8178",
  fontSize: "12px",
};

const actionRowStyle = {
  display: "flex",
  gap: "10px",
  marginTop: "16px",
  flexWrap: "wrap",
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

const secondaryButtonStyle = {
  flex: 1,
  minWidth: "110px",
  padding: "10px 16px",
  border: "1.5px solid #2D2B28",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
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
  width: "min(420px, 92vw)",
  backgroundColor: "#FFFFFF",
  padding: "28px",
  borderRadius: "18px",
  border: "1.5px solid #2D2B28",
};

const modalButtonsStyle = {
  display: "flex",
  gap: "10px",
  marginTop: "20px",
};
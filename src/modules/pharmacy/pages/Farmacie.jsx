import { useEffect, useState } from "react";
import { supabase } from "../services/reportSupabase";
import SchedaFarmacia from "./SchedaFarmacia.jsx";

const regioniImport = [
  "Abruzzo",
  "Basilicata",
  "Calabria",
  "Campania",
  "Emilia-Romagna",
  "Friuli-Venezia Giulia",
  "Lazio",
  "Liguria",
  "Lombardia",
  "Marche",
  "Molise",
  "Piemonte",
  "Puglia",
  "Sardegna",
  "Sicilia",
  "Toscana",
  "Trentino-Alto Adige",
  "Umbria",
  "Valle d'Aosta",
  "Veneto",
];

export default function Farmacie({ utente }) {
  const [farmacie, setFarmacie] = useState([]);
  const [regioni, setRegioni] = useState([]);
  const [province, setProvince] = useState([]);
  const [beauty, setBeauty] = useState([]);
  const [ricerca, setRicerca] = useState("");

  const [mostraForm, setMostraForm] = useState(false);
  const [mostraAggiorna, setMostraAggiorna] = useState(false);
  const [farmaciaInModifica, setFarmaciaInModifica] = useState(null);
  const [farmaciaScheda, setFarmaciaScheda] = useState(null);
  const [importInCorso, setImportInCorso] = useState(false);

  const [nome, setNome] = useState("");
  const [indirizzo, setIndirizzo] = useState("");
  const [citta, setCitta] = useState("");
  const [regioneId, setRegioneId] = useState("");
  const [provinciaId, setProvinciaId] = useState("");
  const [beautyId, setBeautyId] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");

  const puoEliminare = utente?.ruolo === "admin";

  useEffect(() => {
    caricaDati();
  }, []);

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

    const regioniRes = await supabase
      .from("regioni")
      .select("*")
      .order("nome", { ascending: true });

    const provinceRes = await supabase
      .from("province")
      .select("*")
      .order("nome", { ascending: true });

    const beautyRes = await supabase
      .from("beauty_consultant")
      .select("*")
      .eq("attivo", true)
      .order("cognome", { ascending: true });

    if (regioniRes.error) return alert(regioniRes.error.message);
    if (provinceRes.error) return alert(provinceRes.error.message);
    if (beautyRes.error) return alert(beautyRes.error.message);

    setFarmacie(farmacieData);
    setRegioni(regioniRes.data || []);
    setProvince(provinceRes.data || []);
    setBeauty(beautyRes.data || []);
  }

  async function aggiornaFarmacieRegione(regione) {
    const conferma = window.confirm(
      `Vuoi aggiornare l'elenco farmacie per ${regione}?`
    );

    if (!conferma) return;

    setImportInCorso(true);

    const { data, error } = await supabase.functions.invoke(
      "update-farmacie-regione",
      {
        body: { regione: regione.toUpperCase() },
      }
    );

    setImportInCorso(false);

    if (error) {
      alert(error.message);
      return;
    }

    if (data?.success === false) {
      alert(data.error);
      return;
    }

    alert(`Aggiornamento completato. Farmacie importate: ${data.importate}`);
    await caricaDati();
  }

  const provinceFiltrate = province.filter(
    (provincia) => provincia.regione_id === regioneId
  );

  function getRegioneNome(id) {
    return regioni.find((r) => r.id === id)?.nome || "";
  }

  function getProvinciaLabel(id) {
    const provincia = province.find((p) => p.id === id);
    return provincia ? `${provincia.nome} (${provincia.sigla})` : "";
  }

  function getBeautyLabel(id) {
    const b = beauty.find((item) => item.id === id);
    return b ? `${b.cognome || ""} ${b.nome || ""}`.trim() : "";
  }

  const farmacieFiltrate = farmacie.filter((farmacia) => {
    const testo = `${farmacia.nome || ""} ${farmacia.citta || ""} ${getBeautyLabel(
      farmacia.beauty_id
    )}`.toLowerCase();

    return testo.includes(ricerca.toLowerCase());
  });

  function svuotaForm() {
    setNome("");
    setIndirizzo("");
    setCitta("");
    setRegioneId("");
    setProvinciaId("");
    setBeautyId("");
    setTelefono("");
    setEmail("");
    setFarmaciaInModifica(null);
  }

  function apriNuovaFarmacia() {
    svuotaForm();
    setMostraForm(true);
    setMostraAggiorna(false);
  }

  function tornaIndietro() {
    svuotaForm();
    setMostraForm(false);
    setMostraAggiorna(false);
  }

  function modificaFarmacia(farmacia) {
    setFarmaciaInModifica(farmacia);
    setNome(farmacia.nome || "");
    setIndirizzo(farmacia.indirizzo || "");
    setCitta(farmacia.citta || "");
    setRegioneId(farmacia.regione_id || "");
    setProvinciaId(farmacia.provincia_id || "");
    setBeautyId(farmacia.beauty_id || "");
    setTelefono(farmacia.telefono || "");
    setEmail(farmacia.email || "");
    setMostraForm(true);
    setMostraAggiorna(false);
  }

  async function salvaFarmacia(e) {
    e.preventDefault();

    const datiFarmacia = {
      nome,
      indirizzo,
      citta,
      regione_id: regioneId,
      provincia_id: provinciaId,
      beauty_id: beautyId || null,
      telefono,
      email,
    };

    const response = farmaciaInModifica
      ? await supabase
          .from("farmacie")
          .update(datiFarmacia)
          .eq("id", farmaciaInModifica.id)
      : await supabase.from("farmacie").insert([datiFarmacia]);

    if (response.error) {
      alert(response.error.message);
      return;
    }

    svuotaForm();
    setMostraForm(false);
    await caricaDati();
  }

  async function eliminaFarmacia(farmacia) {
    const conferma = window.confirm(
      `Vuoi eliminare la farmacia "${farmacia.nome}"?`
    );

    if (!conferma) return;

    const { error } = await supabase
      .from("farmacie")
      .delete()
      .eq("id", farmacia.id);

    if (error) {
      alert(error.message);
      return;
    }

    await caricaDati();
  }

  if (farmaciaScheda) {
    return (
      <SchedaFarmacia
        farmacia={farmaciaScheda}
        beauty={beauty}
        onBack={async () => {
          setFarmaciaScheda(null);
          await caricaDati();
        }}
      />
    );
  }

  return (
    <div>
      <div style={headerStyle}>
        <h2>
          {mostraForm
            ? farmaciaInModifica
              ? "Modifica farmacia"
              : "Nuova farmacia"
            : mostraAggiorna
            ? "Aggiorna farmacie"
            : "Farmacie"}
        </h2>

        {!mostraForm && !mostraAggiorna && (
          <p style={subtitleStyle}>Gestisci farmacie e schede CRM</p>
        )}
      </div>

      {mostraAggiorna && (
        <div style={formStyle}>
          <button type="button" style={backButtonStyle} onClick={tornaIndietro}>
            ← Torna indietro
          </button>

          <p style={subtitleStyle}>
            Seleziona una regione per aggiornare l’elenco farmacie dal file
            ufficiale importato.
          </p>

          <div style={regionGridStyle}>
            {regioniImport.map((regione) => (
              <button
                key={regione}
                style={historyButtonStyle}
                onClick={() => aggiornaFarmacieRegione(regione)}
                disabled={importInCorso}
              >
                {importInCorso ? "Aggiornamento..." : regione}
              </button>
            ))}
          </div>
        </div>
      )}

      {!mostraForm && !mostraAggiorna && (
        <>
          <input
            style={searchStyle}
            placeholder="Ricerca rapida..."
            value={ricerca}
            onChange={(e) => setRicerca(e.target.value)}
          />

          <button style={primaryButtonStyle} onClick={apriNuovaFarmacia}>
            + Nuova farmacia
          </button>

          {utente?.ruolo === "admin" && (
            <button
              style={historyButtonStyle}
              onClick={() => setMostraAggiorna(true)}
            >
              Aggiorna elenco farmacie
            </button>
          )}
        </>
      )}

      {mostraForm && (
        <form onSubmit={salvaFarmacia} style={formStyle}>
          <button type="button" style={backButtonStyle} onClick={tornaIndietro}>
            ← Torna indietro
          </button>

          <input
            style={inputStyle}
            placeholder="Nome farmacia"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
          />

          <input
            style={inputStyle}
            placeholder="Indirizzo"
            value={indirizzo}
            onChange={(e) => setIndirizzo(e.target.value)}
          />

          <input
            style={inputStyle}
            placeholder="Città"
            value={citta}
            onChange={(e) => setCitta(e.target.value)}
          />

          <select
            style={inputStyle}
            value={regioneId}
            onChange={(e) => {
              setRegioneId(e.target.value);
              setProvinciaId("");
            }}
            required
          >
            <option value="">Seleziona regione</option>
            {regioni.map((regione) => (
              <option key={regione.id} value={regione.id}>
                {regione.nome}
              </option>
            ))}
          </select>

          <select
            style={inputStyle}
            value={provinciaId}
            onChange={(e) => setProvinciaId(e.target.value)}
            required
            disabled={!regioneId}
          >
            <option value="">Seleziona provincia</option>
            {provinceFiltrate.map((provincia) => (
              <option key={provincia.id} value={provincia.id}>
                {provincia.nome} ({provincia.sigla})
              </option>
            ))}
          </select>

          <select
            style={inputStyle}
            value={beautyId}
            onChange={(e) => setBeautyId(e.target.value)}
          >
            <option value="">Seleziona referente beauty</option>
            {beauty.map((b) => (
              <option key={b.id} value={b.id}>
                {b.cognome} {b.nome}
              </option>
            ))}
          </select>

          <input
            style={inputStyle}
            placeholder="Telefono"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
          />

          <input
            style={inputStyle}
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <button style={saveButtonStyle} type="submit">
            {farmaciaInModifica ? "Aggiorna farmacia" : "Salva farmacia"}
          </button>
        </form>
      )}

      {!mostraForm && !mostraAggiorna && (
        <div style={listStyle}>
          {farmacieFiltrate.map((farmacia) => (
            <div key={farmacia.id} style={cardStyle}>
              <h3 style={cardTitleStyle}>{farmacia.nome}</h3>

              {farmacia.indirizzo && (
                <p style={cardTextStyle}>
                  <span style={labelStyle}>Indirizzo:</span>{" "}
                  {farmacia.indirizzo}
                </p>
              )}

              <p style={cardTextStyle}>
                <span style={labelStyle}>Città:</span> {farmacia.citta}
              </p>

              <p style={cardTextStyle}>
                <span style={labelStyle}>Regione:</span>{" "}
                {getRegioneNome(farmacia.regione_id)}
              </p>

              <p style={cardTextStyle}>
                <span style={labelStyle}>Provincia:</span>{" "}
                {getProvinciaLabel(farmacia.provincia_id)}
              </p>

              {farmacia.beauty_id && (
                <p style={cardTextStyle}>
                  <span style={labelStyle}>Referente beauty:</span>{" "}
                  {getBeautyLabel(farmacia.beauty_id)}
                </p>
              )}

              {farmacia.telefono && (
                <p style={cardTextStyle}>
                  <span style={labelStyle}>Telefono:</span> {farmacia.telefono}
                </p>
              )}

              {farmacia.email && (
                <p style={cardTextStyle}>
                  <span style={labelStyle}>Email:</span> {farmacia.email}
                </p>
              )}

              <div style={actionRowStyle}>
                <button
                  style={editButtonStyle}
                  onClick={() => modificaFarmacia(farmacia)}
                >
                  Modifica
                </button>

                <button
                  style={historyButtonStyle}
                  onClick={() => setFarmaciaScheda(farmacia)}
                >
                  Scheda farmacia
                </button>

                {puoEliminare && (
                  <button
                    style={deleteButtonStyle}
                    onClick={() => eliminaFarmacia(farmacia)}
                  >
                    Elimina
                  </button>
                )}
              </div>
            </div>
          ))}
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

const searchStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "15px",
  marginBottom: "14px",
  borderRadius: "14px",
  border: "1.5px solid #2D2B28",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  fontSize: "15px",
};

const primaryButtonStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "15px",
  marginBottom: "20px",
  border: "1px solid #6B645C",
  borderRadius: "16px",
  backgroundColor: "#6B645C",
  color: "#FFFFFF",
  fontSize: "16px",
  fontWeight: "600",
  cursor: "pointer",
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
  marginBottom: "4px",
  border: "1.5px solid #2D2B28",
  borderRadius: "14px",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  fontSize: "15px",
  fontWeight: "600",
  cursor: "pointer",
};

const actionRowStyle = {
  display: "flex",
  gap: "10px",
  marginTop: "16px",
  flexWrap: "wrap",
};

const editButtonStyle = {
  flex: 1,
  minWidth: "90px",
  padding: "10px 16px",
  border: "1px solid #B8ADA4",
  borderRadius: "12px",
  backgroundColor: "#F7F5F2",
  color: "#2D2B28",
  fontSize: "14px",
  fontWeight: "600",
  cursor: "pointer",
};

const historyButtonStyle = {
  flex: 1,
  minWidth: "120px",
  padding: "10px 16px",
  border: "1px solid #2D2B28",
  borderRadius: "12px",
  backgroundColor: "#2D2B28",
  color: "#FFFFFF",
  fontSize: "14px",
  fontWeight: "600",
  cursor: "pointer",
};

const deleteButtonStyle = {
  flex: 1,
  minWidth: "90px",
  padding: "10px 16px",
  border: "1px solid #8B0000",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  color: "#8B0000",
  fontSize: "14px",
  fontWeight: "600",
  cursor: "pointer",
};

const formStyle = {
  display: "grid",
  gap: "12px",
  padding: "20px",
  marginBottom: "24px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
  boxShadow: "0 2px 10px rgba(107,100,92,0.08)",
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "14px",
  borderRadius: "12px",
  border: "1px solid #D8D1CB",
  fontSize: "15px",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
};

const regionGridStyle = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "10px",
};

const listStyle = { display: "grid", gap: "16px" };

const cardStyle = {
  padding: "20px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
  boxShadow: "0 2px 10px rgba(107,100,92,0.06)",
  lineHeight: "1.6",
};

const cardTitleStyle = {
  color: "#2D2B28",
  marginBottom: "10px",
};

const cardTextStyle = {
  color: "#4A4641",
  fontSize: "14px",
  marginBottom: "4px",
};

const labelStyle = {
  color: "#6B645C",
  fontWeight: "600",
};
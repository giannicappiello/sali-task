import { useEffect, useState } from "react";
import { supabase } from "../services/reportSupabase";

export default function SchedaFarmacia({ farmacia, beauty, onBack }) {
  const [giornate, setGiornate] = useState([]);
  const [vendite, setVendite] = useState([]);
  const [noteCommerciali, setNoteCommerciali] = useState(
    farmacia.note_commerciali || ""
  );

  useEffect(() => {
    caricaDati();
  }, []);

  async function caricaDati() {
    const giornateRes = await supabase
      .from("giornate_promozionali")
      .select("*")
      .eq("farmacia_id", farmacia.id)
      .order("data", { ascending: false });

    if (giornateRes.error) return alert(giornateRes.error.message);

    const giornateData = giornateRes.data || [];
    setGiornate(giornateData);

    const ids = giornateData.map((g) => g.id);

    if (ids.length === 0) {
      setVendite([]);
      return;
    }

    const venditeRes = await supabase
      .from("vendite_prodotti")
      .select("*")
      .in("giornata_id", ids);

    if (venditeRes.error) return alert(venditeRes.error.message);

    setVendite(venditeRes.data || []);
  }

  function formatDataIt(dataIso) {
    if (!dataIso) return "";
    const [anno, mese, giorno] = dataIso.split("-");
    return `${giorno}/${mese}/${anno.slice(2)}`;
  }

  function getBeautyNome(id) {
    const b = beauty.find((item) => item.id === id);
    return b ? `${b.cognome || ""} ${b.nome || ""}`.trim() : "Non indicata";
  }

  const giornateEseguite = giornate.filter((g) => g.stato === "eseguita");

  const fatturatoTotale = giornateEseguite.reduce(
    (tot, g) => tot + Number(g.fatturato_giornata || 0),
    0
  );

  const pezziVenduti = giornateEseguite.reduce(
    (tot, g) => tot + Number(g.numero_totale_pezzi_venduti || 0),
    0
  );

  const fatturatoMedio =
    giornateEseguite.length > 0
      ? fatturatoTotale / giornateEseguite.length
      : 0;

  const prodottiVenduti = {};

  vendite.forEach((v) => {
    const nome = v.nome_prodotto || "Non indicato";
    prodottiVenduti[nome] =
      (prodottiVenduti[nome] || 0) + Number(v.quantita || 0);
  });

  const topProdotti = Object.entries(prodottiVenduti)
    .map(([nome, quantita]) => ({ nome, quantita }))
    .sort((a, b) => b.quantita - a.quantita);

  const beautyCoinvolte = [...new Set(giornate.map((g) => g.consultant_id))]
    .filter(Boolean)
    .map((id) => getBeautyNome(id));

  const oggi = new Date().toISOString().split("T")[0];

  const prossimaGiornata = giornate
    .filter((g) => g.data >= oggi && g.stato === "pianificata")
    .sort((a, b) => new Date(a.data) - new Date(b.data))[0];

  async function salvaNoteCommerciali() {
    const { error } = await supabase
      .from("farmacie")
      .update({ note_commerciali: noteCommerciali })
      .eq("id", farmacia.id);

    if (error) return alert(error.message);

    alert("Note commerciali salvate");
  }

  return (
    <div>
      <div style={headerStyle}>
        <h2>Scheda farmacia</h2>
        <p style={subtitleStyle}>{farmacia.nome}</p>
      </div>

      <button style={backButtonStyle} onClick={onBack}>
        ← Torna indietro
      </button>

      <div style={sectionStyle}>
        <h3>Dati farmacia</h3>
        <p><strong>Indirizzo:</strong> {farmacia.indirizzo || "-"}</p>
        <p><strong>Città:</strong> {farmacia.citta || "-"}</p>
        <p><strong>Telefono:</strong> {farmacia.telefono || "-"}</p>
        <p><strong>Email:</strong> {farmacia.email || "-"}</p>
      </div>

      <div style={kpiGridStyle}>
        <div style={kpiCardStyle}>
          <h3>{giornate.length}</h3>
          <p>Giornate totali</p>
        </div>

        <div style={kpiCardStyle}>
          <h3>{giornateEseguite.length}</h3>
          <p>Giornate eseguite</p>
        </div>

        <div style={kpiCardStyle}>
          <h3>€ {fatturatoTotale.toFixed(2)}</h3>
          <p>Fatturato totale</p>
        </div>

        <div style={kpiCardStyle}>
          <h3>€ {fatturatoMedio.toFixed(2)}</h3>
          <p>Fatturato medio</p>
        </div>

        <div style={kpiCardStyle}>
          <h3>{pezziVenduti}</h3>
          <p>Pezzi venduti</p>
        </div>
      </div>

      <div style={sectionStyle}>
        <h3>Prossima giornata programmata</h3>
        {prossimaGiornata ? (
          <>
            <p><strong>Data:</strong> {formatDataIt(prossimaGiornata.data)}</p>
            <p><strong>Beauty:</strong> {getBeautyNome(prossimaGiornata.consultant_id)}</p>
            <p><strong>Stato:</strong> {prossimaGiornata.stato}</p>
          </>
        ) : (
          <p>Nessuna giornata programmata.</p>
        )}
      </div>

      <div style={sectionStyle}>
        <h3>Beauty che hanno seguito la farmacia</h3>
        {beautyCoinvolte.length === 0 && <p>Nessuna beauty associata.</p>}
        {beautyCoinvolte.map((nome) => (
          <p key={nome}>{nome}</p>
        ))}
      </div>

      <div style={sectionStyle}>
        <h3>Prodotti venduti</h3>
        {topProdotti.length === 0 && <p>Nessun prodotto venduto.</p>}
        {topProdotti.map((p) => (
          <div key={p.nome} style={rowStyle}>
            <span>{p.nome}</span>
            <strong>{p.quantita} pz</strong>
          </div>
        ))}
      </div>

      <div style={sectionStyle}>
        <h3>Storico giornate</h3>
        {giornate.length === 0 && <p>Nessuna giornata registrata.</p>}

        {giornate.map((g) => (
          <div key={g.id} style={historyCardStyle}>
            <h4>{formatDataIt(g.data)}</h4>
            <p><strong>Beauty:</strong> {getBeautyNome(g.consultant_id)}</p>
            <p><strong>Stato:</strong> {g.stato}</p>
            <p><strong>Fatturato:</strong> € {Number(g.fatturato_giornata || 0).toFixed(2)}</p>
            <p><strong>Pezzi:</strong> {Number(g.numero_totale_pezzi_venduti || 0)}</p>
          </div>
        ))}
      </div>

      <div style={sectionStyle}>
        <h3>Note commerciali</h3>
        <textarea
          style={textareaStyle}
          value={noteCommerciali}
          onChange={(e) => setNoteCommerciali(e.target.value)}
          placeholder="Inserisci note commerciali sulla farmacia..."
        />

        <button style={saveButtonStyle} onClick={salvaNoteCommerciali}>
          Salva note commerciali
        </button>
      </div>
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

const sectionStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "18px",
  marginBottom: "18px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
};

const kpiGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: "14px",
  marginBottom: "22px",
};

const kpiCardStyle = {
  padding: "18px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
  textAlign: "center",
};

const rowStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 80px",
  gap: "10px",
  padding: "10px",
  borderRadius: "10px",
  backgroundColor: "#F7F5F2",
  marginBottom: "8px",
};

const historyCardStyle = {
  padding: "14px",
  borderRadius: "14px",
  backgroundColor: "#F7F5F2",
  marginBottom: "12px",
};

const textareaStyle = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: "110px",
  padding: "12px",
  borderRadius: "12px",
  border: "1px solid #D8D1CB",
  fontSize: "15px",
  marginBottom: "12px",
};

const backButtonStyle = {
  width: "100%",
  padding: "13px",
  marginBottom: "18px",
  border: "1.5px solid #2D2B28",
  borderRadius: "14px",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  fontWeight: "600",
  cursor: "pointer",
};

const saveButtonStyle = {
  width: "100%",
  padding: "13px",
  border: "1.5px solid #2D2B28",
  borderRadius: "14px",
  backgroundColor: "#2D2B28",
  color: "#FFFFFF",
  fontWeight: "600",
  cursor: "pointer",
};
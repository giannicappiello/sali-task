import { useEffect, useState } from "react";
import { supabase } from "../services/reportSupabase";

export default function StoricoFarmacia({ farmacia, onBack }) {
  const [giornate, setGiornate] = useState([]);
  const [vendite, setVendite] = useState([]);

  useEffect(() => {
    caricaStorico();
  }, []);

  async function caricaStorico() {
    const { data: giornateData, error: giornateError } = await supabase
      .from("giornate_promozionali")
      .select("*")
      .eq("farmacia_id", farmacia.id)
      .order("data", { ascending: false });

    if (giornateError) {
      alert(giornateError.message);
      return;
    }

    setGiornate(giornateData || []);

    const idsGiornate = (giornateData || []).map((g) => g.id);

    if (idsGiornate.length === 0) {
      setVendite([]);
      return;
    }

    const { data: venditeData, error: venditeError } = await supabase
      .from("vendite_prodotti")
      .select("*")
      .in("giornata_id", idsGiornate);

    if (venditeError) {
      alert(venditeError.message);
      return;
    }

    setVendite(venditeData || []);
  }

  function formatData(dataIso) {
    if (!dataIso) return "";
    const [anno, mese, giorno] = dataIso.split("-");
    return `${giorno}/${mese}/${anno.slice(2)}`;
  }

  function getMeseLabel(dataIso) {
    if (!dataIso) return "";
    const [anno, mese] = dataIso.split("-");
    const data = new Date(Number(anno), Number(mese) - 1, 1);

    return data.toLocaleDateString("it-IT", {
      month: "short",
      year: "2-digit",
    });
  }

  const giornateEseguite = giornate.filter((g) => g.stato === "eseguita");

  const fatturatoTotale = giornateEseguite.reduce(
    (tot, g) => tot + Number(g.fatturato_giornata || 0),
    0
  );

  const mediaFatturato =
    giornateEseguite.length > 0
      ? fatturatoTotale / giornateEseguite.length
      : 0;

  const prodottiAggregati = vendite.reduce((acc, vendita) => {
    const nome = vendita.nome_prodotto || "Prodotto non indicato";

    if (!acc[nome]) {
      acc[nome] = {
        nome,
        quantita: 0,
        totale: 0,
      };
    }

    acc[nome].quantita += Number(vendita.quantita || 0);
    acc[nome].totale += Number(vendita.totale_riga || 0);

    return acc;
  }, {});

  const prodottiTop = Object.values(prodottiAggregati).sort(
    (a, b) => b.quantita - a.quantita
  );

  const fatturatoPerMese = giornateEseguite.reduce((acc, giornata) => {
    const mese = getMeseLabel(giornata.data);

    if (!acc[mese]) {
      acc[mese] = 0;
    }

    acc[mese] += Number(giornata.fatturato_giornata || 0);

    return acc;
  }, {});

  const datiGrafico = Object.entries(fatturatoPerMese);

  const massimoFatturato =
    datiGrafico.length > 0
      ? Math.max(...datiGrafico.map(([, valore]) => valore))
      : 0;

  return (
    <div>
      <div style={headerStyle}>
        <h2>Storico Farmacia</h2>
        <p style={subtitleStyle}>{farmacia.nome}</p>
      </div>

      <button style={backButtonStyle} onClick={onBack}>
        ← Torna indietro
      </button>

      <div style={kpiGridStyle}>
        <div style={kpiCardStyle}>
          <h3>{giornateEseguite.length}</h3>
          <p>Giornate fatte</p>
        </div>

        <div style={kpiCardStyle}>
          <h3>€ {fatturatoTotale.toFixed(2)}</h3>
          <p>Fatturato totale</p>
        </div>

        <div style={kpiCardStyle}>
          <h3>€ {mediaFatturato.toFixed(2)}</h3>
          <p>Media giornata</p>
        </div>
      </div>

      <h3 style={sectionTitleStyle}>Fatturato per mese</h3>

      <div style={chartStyle}>
        {datiGrafico.length === 0 && <p>Nessun dato disponibile</p>}

        {datiGrafico.map(([mese, valore]) => {
          const larghezza =
            massimoFatturato > 0 ? (valore / massimoFatturato) * 100 : 0;

          return (
            <div key={mese} style={chartRowStyle}>
              <div style={chartLabelStyle}>{mese}</div>

              <div style={barContainerStyle}>
                <div style={{ ...barStyle, width: `${larghezza}%` }} />
              </div>

              <div style={chartValueStyle}>€ {valore.toFixed(2)}</div>
            </div>
          );
        })}
      </div>

      <h3 style={sectionTitleStyle}>Storico giornate</h3>

      <div style={listStyle}>
        {giornate.map((giornata) => (
          <div key={giornata.id} style={cardStyle}>
            <p>
              <span style={labelStyle}>Data:</span> {formatData(giornata.data)}
            </p>

            <p>
              <span style={labelStyle}>Stato:</span> {giornata.stato}
            </p>

            <p>
              <span style={labelStyle}>Fatturato:</span> €{" "}
              {Number(giornata.fatturato_giornata || 0).toFixed(2)}
            </p>

            <p>
              <span style={labelStyle}>Pezzi venduti:</span>{" "}
              {giornata.numero_totale_pezzi_venduti || 0}
            </p>
          </div>
        ))}
      </div>

      <h3 style={sectionTitleStyle}>Prodotti più venduti</h3>

      <div style={listStyle}>
        {prodottiTop.length === 0 && (
          <div style={cardStyle}>
            <p>Nessun prodotto venduto registrato.</p>
          </div>
        )}

        {prodottiTop.map((prodotto) => (
          <div key={prodotto.nome} style={cardStyle}>
            <h3>{prodotto.nome}</h3>

            <p>
              <span style={labelStyle}>Quantità:</span> {prodotto.quantita}
            </p>

            <p>
              <span style={labelStyle}>Totale venduto:</span> €{" "}
              {prodotto.totale.toFixed(2)}
            </p>
          </div>
        ))}
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

const kpiGridStyle = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "12px",
  marginBottom: "24px",
};

const kpiCardStyle = {
  padding: "18px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
  textAlign: "center",
};

const sectionTitleStyle = {
  margin: "24px 0 14px",
};

const chartStyle = {
  padding: "18px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
  display: "grid",
  gap: "12px",
};

const chartRowStyle = {
  display: "grid",
  gridTemplateColumns: "70px 1fr 90px",
  alignItems: "center",
  gap: "10px",
};

const chartLabelStyle = {
  fontSize: "13px",
  fontWeight: "600",
};

const barContainerStyle = {
  height: "14px",
  borderRadius: "999px",
  backgroundColor: "#E6E0DA",
  overflow: "hidden",
};

const barStyle = {
  height: "100%",
  borderRadius: "999px",
  backgroundColor: "#2D2B28",
};

const chartValueStyle = {
  fontSize: "13px",
  textAlign: "right",
};

const listStyle = {
  display: "grid",
  gap: "14px",
};

const cardStyle = {
  padding: "18px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
  lineHeight: "1.6",
};

const labelStyle = {
  color: "#6B645C",
  fontWeight: "600",
};
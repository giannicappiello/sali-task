import { formatEuro } from "../../utils/dashboardUtils";
import InfoTooltip from "../../../../components/InfoTooltip";

export default function DashboardKpi({
  fatturatoPeriodo,
  richiesteContattoPeriodo,
  giornateEseguite,
  giornatePianificate,
  nuoveAperturePeriodo,
  pezziVenduti,
  conversione,
  mediaFatturato,
}) {
  return (
    <div style={kpiGridStyle}>
      <div style={kpiCardStyle}>
        <h3>{formatEuro(fatturatoPeriodo)}</h3>
        <p>Fatturato periodo<InfoTooltip label="Fatturato periodo" text="Somma del fatturato registrato nelle giornate eseguite comprese nel periodo selezionato." /></p>
      </div>

      <div style={kpiCardStyle}>
        <h3>{richiesteContattoPeriodo}</h3>
        <p>Richieste di contatto<InfoTooltip label="Richieste di contatto" text="Numero di richieste di contatto registrate nel periodo selezionato." /></p>
      </div>

      <div style={kpiCardStyle}>
        <h3>{giornateEseguite}</h3>
        <p>Giornate eseguite<InfoTooltip label="Giornate eseguite" text="Numero di giornate farmacia concluse nel periodo selezionato." /></p>
      </div>

      <div style={kpiCardStyle}>
        <h3>{giornatePianificate}</h3>
        <p>Giornate pianificate<InfoTooltip label="Giornate pianificate" text="Numero di giornate farmacia programmate nel periodo selezionato." /></p>
      </div>

      <div style={kpiCardStyle}>
        <h3>{nuoveAperturePeriodo}</h3>
        <p>Nuove aperture<InfoTooltip label="Nuove aperture" text="Numero di nuove aperture registrate nel periodo selezionato." /></p>
      </div>

      <div style={kpiCardStyle}>
        <h3>{pezziVenduti}</h3>
        <p>Pezzi venduti<InfoTooltip label="Pezzi venduti" text="Somma delle quantità vendute registrate nelle giornate del periodo." /></p>
      </div>

      <div style={kpiCardStyle}>
        <h3>{conversione.toFixed(1)}%</h3>
        <p>Conversione clienti<InfoTooltip label="Conversione clienti" text="Rapporto percentuale tra clienti convertiti e contatti utili registrati nel periodo." /></p>
      </div>

      <div style={kpiCardStyle}>
        <h3>{formatEuro(mediaFatturato)}</h3>
        <p>Fatturato medio per giornata eseguita<InfoTooltip label="Fatturato medio" text="Fatturato totale del periodo diviso per il numero di giornate eseguite." /></p>
      </div>
    </div>
  );
}

const kpiGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: "14px",
  marginBottom: "26px",
};

const kpiCardStyle = {
  padding: "20px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
  textAlign: "center",
};

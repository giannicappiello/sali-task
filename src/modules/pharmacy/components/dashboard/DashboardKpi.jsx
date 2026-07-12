import { formatEuro } from "../../utils/dashboardUtils";

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
        <p>Fatturato periodo</p>
      </div>

      <div style={kpiCardStyle}>
        <h3>{richiesteContattoPeriodo}</h3>
        <p>Richieste di contatto</p>
      </div>

      <div style={kpiCardStyle}>
        <h3>{giornateEseguite}</h3>
        <p>Giornate eseguite</p>
      </div>

      <div style={kpiCardStyle}>
        <h3>{giornatePianificate}</h3>
        <p>Giornate pianificate</p>
      </div>

      <div style={kpiCardStyle}>
        <h3>{nuoveAperturePeriodo}</h3>
        <p>Nuove aperture</p>
      </div>

      <div style={kpiCardStyle}>
        <h3>{pezziVenduti}</h3>
        <p>Pezzi venduti</p>
      </div>

      <div style={kpiCardStyle}>
        <h3>{conversione.toFixed(1)}%</h3>
        <p>Conversione clienti</p>
      </div>

      <div style={kpiCardStyle}>
        <h3>{formatEuro(mediaFatturato)}</h3>
        <p>Fatturato medio per giornata eseguita</p>
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
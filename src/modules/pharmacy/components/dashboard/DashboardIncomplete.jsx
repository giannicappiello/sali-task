import { formatDataIt, formatEuro } from "../../utils/dashboardUtils";

export default function DashboardIncomplete({
  giornateSenzaReport,
  getFarmaciaNome,
  getBeautyNome,
  setMostraIncomplete,
  setGiornataReport,
}) {
  return (
    <div>
      <div style={headerStyle}>
        <h2>Giornate incomplete</h2>
        <p style={subtitleStyle}>Giornate passate senza report compilato</p>
      </div>

      <button style={backButtonStyle} onClick={() => setMostraIncomplete(false)}>
        ← Torna indietro
      </button>

      <div style={listStyle}>
        {giornateSenzaReport.length === 0 && (
          <div style={sectionStyle}>Nessuna giornata incompleta.</div>
        )}

        {giornateSenzaReport.map((g) => (
          <div key={g.id} style={cardStyle}>
            <h3>{getFarmaciaNome(g.farmacia_id)}</h3>
            <p><strong>Data:</strong> {formatDataIt(g.data)}</p>
            <p><strong>Beauty:</strong> {getBeautyNome(g.consultant_id)}</p>
            <p><strong>Obiettivo:</strong> {formatEuro(g.obiettivo_vendite)}</p>

            <button style={primaryButtonStyle} onClick={() => setGiornataReport(g)}>
              Compila report
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const headerStyle = { textAlign: "center", marginBottom: "22px" };
const subtitleStyle = { fontSize: "14px", color: "#6B645C", marginTop: "6px" };
const sectionStyle = { padding: "20px", borderRadius: "18px", backgroundColor: "#FFFFFF", border: "1.5px solid #2D2B28" };
const backButtonStyle = { width: "100%", padding: "13px", marginBottom: "14px", border: "1.5px solid #2D2B28", borderRadius: "14px", backgroundColor: "#FFFFFF", color: "#2D2B28", fontWeight: "600", cursor: "pointer" };
const primaryButtonStyle = { width: "100%", padding: "13px", marginBottom: "10px", border: "1.5px solid #2D2B28", borderRadius: "14px", backgroundColor: "#2D2B28", color: "#FFFFFF", fontWeight: "700", cursor: "pointer" };
const listStyle = { display: "grid", gap: "14px" };
const cardStyle = { width: "100%", boxSizing: "border-box", padding: "18px", borderRadius: "16px", backgroundColor: "#FFFFFF", border: "1.5px solid #2D2B28" };
import { formatEuro } from "../../utils/dashboardUtils";

export default function DashboardObiettivi({
  raggiungimentoObiettivi,
  totaleObiettivi,
  fatturatoSuObiettivi,
  scostamentoTotale,
  farmacieSopraObiettivo,
  farmacieSottoObiettivo,
  beautySopraObiettivo,
  beautySottoObiettivo,
  esportaObiettivi,
}) {
  return (
    <div style={sectionStyle}>
      <h3>Obiettivi e scostamenti</h3>

      <div style={kpiGridStyle}>
        <div style={kpiCardStyle}>
          <h3>{raggiungimentoObiettivi.toFixed(1)}%</h3>
          <p>Raggiungimento obiettivi</p>
        </div>

        <div style={kpiCardStyle}>
          <h3>{formatEuro(totaleObiettivi)}</h3>
          <p>Obiettivo totale</p>
        </div>

        <div style={kpiCardStyle}>
          <h3>{formatEuro(fatturatoSuObiettivi)}</h3>
          <p>Fatturato su giornate con obiettivo</p>
        </div>

        <div style={kpiCardStyle}>
          <h3>{formatEuro(scostamentoTotale)}</h3>
          <p>Scostamento totale</p>
        </div>
      </div>

      <div style={rankingGridStyle}>
        <MiniExport title="Farmacie sopra obiettivo" file="farmacie_sopra_obiettivo" data={farmacieSopraObiettivo} esporta={esportaObiettivi} />
        <MiniExport title="Farmacie sotto obiettivo" file="farmacie_sotto_obiettivo" data={farmacieSottoObiettivo} esporta={esportaObiettivi} />
        <MiniExport title="Beauty sopra obiettivo" file="beauty_sopra_obiettivo" data={beautySopraObiettivo} esporta={esportaObiettivi} />
        <MiniExport title="Beauty sotto obiettivo" file="beauty_sotto_obiettivo" data={beautySottoObiettivo} esporta={esportaObiettivi} />
      </div>
    </div>
  );
}

function MiniExport({ title, file, data, esporta }) {
  return (
    <div style={miniSectionStyle}>
      <h4>{title}</h4>
      <button style={downloadButtonStyle} onClick={() => esporta(file, data)}>
        SCARICA XLS
      </button>
    </div>
  );
}

const sectionStyle = { width: "100%", boxSizing: "border-box", padding: "20px", marginBottom: "22px", borderRadius: "18px", backgroundColor: "#FFFFFF", border: "1.5px solid #2D2B28" };
const kpiGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "14px", marginBottom: "26px" };
const kpiCardStyle = { padding: "20px", borderRadius: "18px", backgroundColor: "#FFFFFF", border: "1.5px solid #2D2B28", textAlign: "center" };
const rankingGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "14px" };
const miniSectionStyle = { padding: "14px", borderRadius: "14px", backgroundColor: "#F7F5F2" };
const downloadButtonStyle = { width: "100%", padding: "12px", border: "1px solid #2D2B28", borderRadius: "12px", backgroundColor: "#2D2B28", color: "#FFFFFF", fontWeight: "700", cursor: "pointer" };
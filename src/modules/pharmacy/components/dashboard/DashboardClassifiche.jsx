import { formatEuro } from "../../utils/dashboardUtils";

export default function DashboardClassifiche({
  topBeauty,
  topProdotti,
  topCategorie,
  esportaClassifica,
}) {
  return (
    <div style={sectionStyle}>
      <h3>Classifiche</h3>

      <div style={rankingGridStyle}>
        <div style={miniSectionStyle}>
          <h4>Top beauty</h4>
          <p><strong>{topBeauty[0]?.nome || "-"}</strong></p>
          <p>{topBeauty[0] ? formatEuro(topBeauty[0].valore) : "-"}</p>
          <button style={downloadButtonStyle} onClick={() => esportaClassifica("top_beauty", topBeauty, "Fatturato")}>
            SCARICA XLS
          </button>
        </div>

        <div style={miniSectionStyle}>
          <h4>Top prodotto</h4>
          <p><strong>{topProdotti[0]?.nome || "-"}</strong></p>
          <p>{topProdotti[0] ? `${topProdotti[0].valore} pz` : "-"}</p>
          <button style={downloadButtonStyle} onClick={() => esportaClassifica("top_prodotti", topProdotti, "Pezzi venduti")}>
            SCARICA XLS
          </button>
        </div>

        <div style={miniSectionStyle}>
          <h4>Top categoria / sottocategoria</h4>
          <p><strong>{topCategorie[0]?.nome || "-"}</strong></p>
          <p>{topCategorie[0] ? `${topCategorie[0].valore} pz` : "-"}</p>
          <button style={downloadButtonStyle} onClick={() => esportaClassifica("top_categorie_sottocategorie", topCategorie, "Pezzi venduti")}>
            SCARICA XLS
          </button>
        </div>
      </div>
    </div>
  );
}

const sectionStyle = { width: "100%", boxSizing: "border-box", padding: "20px", marginBottom: "22px", borderRadius: "18px", backgroundColor: "#FFFFFF", border: "1.5px solid #2D2B28" };
const rankingGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "14px" };
const miniSectionStyle = { padding: "14px", borderRadius: "14px", backgroundColor: "#F7F5F2" };
const downloadButtonStyle = { width: "100%", padding: "12px", border: "1px solid #2D2B28", borderRadius: "12px", backgroundColor: "#2D2B28", color: "#FFFFFF", fontWeight: "700", cursor: "pointer" };
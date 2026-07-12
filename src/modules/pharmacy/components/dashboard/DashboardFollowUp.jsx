import { formatDataIt } from "../../utils/dashboardUtils";

export default function DashboardFollowUp({
  followUpScaduti,
  giornate,
  getFarmaciaNome,
  getBeautyNome,
  aggiornaFollowUpFatto,
  rimandaFollowUp,
  setMostraFollowUpScaduti,
}) {
  return (
    <div>
      <div style={headerStyle}>
        <h2>Follow-up non eseguiti</h2>
        <p style={subtitleStyle}>Azioni commerciali scadute e non completate</p>
      </div>

      <button style={backButtonStyle} onClick={() => setMostraFollowUpScaduti(false)}>
        ← Torna indietro
      </button>

      <div style={listStyle}>
        {followUpScaduti.length === 0 && (
          <div style={cardStyle}>Nessun follow-up scaduto.</div>
        )}

        {followUpScaduti.map((item) => {
          const giornata = giornate.find((g) => g.id === item.giornata_id);

          return (
            <div key={item.id} style={cardStyle}>
              <h3>{item.tipo_azione}</h3>
              <p><strong>Scadenza:</strong> {formatDataIt(item.data_followup)}</p>
              <p><strong>Stato:</strong> {item.stato}</p>

              {giornata && (
                <>
                  <p><strong>Farmacia:</strong> {getFarmaciaNome(giornata.farmacia_id)}</p>
                  <p><strong>Beauty:</strong> {getBeautyNome(giornata.consultant_id)}</p>
                </>
              )}

              {item.note && <p><strong>Note:</strong> {item.note}</p>}

              <button style={primaryButtonStyle} onClick={() => aggiornaFollowUpFatto(item)}>
                Segna come fatto
              </button>

              <button style={secondaryButtonStyle} onClick={() => rimandaFollowUp(item)}>
                Rimanda
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const headerStyle = { textAlign: "center", marginBottom: "22px" };
const subtitleStyle = { fontSize: "14px", color: "#6B645C", marginTop: "6px" };
const backButtonStyle = { width: "100%", padding: "13px", marginBottom: "14px", border: "1.5px solid #2D2B28", borderRadius: "14px", backgroundColor: "#FFFFFF", color: "#2D2B28", fontWeight: "600", cursor: "pointer" };
const primaryButtonStyle = { width: "100%", padding: "13px", marginBottom: "10px", border: "1.5px solid #2D2B28", borderRadius: "14px", backgroundColor: "#2D2B28", color: "#FFFFFF", fontWeight: "700", cursor: "pointer" };
const secondaryButtonStyle = { ...primaryButtonStyle, backgroundColor: "#FFFFFF", color: "#2D2B28" };
const listStyle = { display: "grid", gap: "14px" };
const cardStyle = { width: "100%", boxSizing: "border-box", padding: "18px", borderRadius: "16px", backgroundColor: "#FFFFFF", border: "1.5px solid #2D2B28" };
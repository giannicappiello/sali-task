export default function DashboardRichieste({
  richiesteContattoAperte,
  getBeautyNome,
  trasformaInGiornata,
  evadiRichiestaContatto,
  setMostraRichiesteContatto,
}) {
  return (
    <div>
      <div style={headerStyle}>
        <h2>Richieste di contatto</h2>
        <p style={subtitleStyle}>Richieste aperte da gestire</p>
      </div>

      <button style={backButtonStyle} onClick={() => setMostraRichiesteContatto(false)}>
        ← Torna indietro
      </button>

      <div style={listStyle}>
        {richiesteContattoAperte.length === 0 && (
          <div style={cardStyle}>Nessuna richiesta di contatto aperta.</div>
        )}

        {richiesteContattoAperte.map((item) => (
          <div key={item.id} style={cardStyle}>
            <h3>{item.farmacia_nome || "Farmacia non indicata"}</h3>
            <p><strong>Città:</strong> {item.farmacia_citta || "-"}</p>
            <p><strong>Provincia:</strong> {item.farmacia_provincia || "-"}</p>
            <p><strong>Indirizzo:</strong> {item.farmacia_indirizzo || "-"}</p>
            <p><strong>Beauty:</strong> {item.beauty_nome || getBeautyNome(item.beauty_id)}</p>
            <p><strong>Referente:</strong> {item.referente_nome || "-"}</p>
            <p><strong>Contatto:</strong> {item.referente_contatto || "-"}</p>
            <p><strong>Operatore:</strong> {item.operatore_nome || "-"}</p>

            <button style={primaryButtonStyle} onClick={() => trasformaInGiornata(item)}>
              Trasforma in giornata
            </button>

            <button style={secondaryButtonStyle} onClick={() => evadiRichiestaContatto(item)}>
              Evasa con commento
            </button>
          </div>
        ))}
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
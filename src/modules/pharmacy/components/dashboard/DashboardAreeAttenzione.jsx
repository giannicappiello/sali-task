export default function DashboardAreeAttenzione({
  giornateSenzaReport,
  followUpScaduti,
  richiesteContattoAperteNumero,
  setMostraIncomplete,
  setMostraFollowUpScaduti,
  setMostraRichiesteContatto,
}) {
  return (
    <div style={sectionStyle}>
      <h3>Aree di attenzione</h3>

      <div style={attentionGridStyle}>
        <button
          style={attentionButtonStyle}
          onClick={() => setMostraIncomplete(true)}
        >
          <strong>Giornate incomplete</strong>
          <span>{giornateSenzaReport.length} report non compilati</span>
        </button>

        <button
          style={attentionButtonStyle}
          onClick={() => setMostraFollowUpScaduti(true)}
        >
          <strong>Follow-up non eseguiti</strong>
          <span>{followUpScaduti.length} follow-up scaduti</span>
        </button>

        <button
          style={attentionButtonStyle}
          onClick={() => setMostraRichiesteContatto(true)}
        >
          <strong>Richieste di contatto</strong>
          <span>{richiesteContattoAperteNumero} richieste aperte</span>
        </button>
      </div>
    </div>
  );
}

const sectionStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "20px",
  marginBottom: "22px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
};

const attentionGridStyle = {
  display: "grid",
  gap: "12px",
};

const attentionButtonStyle = {
  width: "100%",
  padding: "16px",
  borderRadius: "14px",
  border: "1.5px solid #2D2B28",
  backgroundColor: "#F7F5F2",
  color: "#2D2B28",
  display: "grid",
  gap: "8px",
  textAlign: "left",
  cursor: "pointer",
};
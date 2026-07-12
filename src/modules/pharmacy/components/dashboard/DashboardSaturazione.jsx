export default function DashboardSaturazione({ saturazioneBeauty }) {
  return (
    <div style={sectionStyle}>
      <h3>Saturazione beauty futura</h3>

      <div style={rankingGridStyle}>
        {saturazioneBeauty.length === 0 && (
          <div style={miniSectionStyle}>Nessuna giornata futura pianificata</div>
        )}

        {saturazioneBeauty.map((item) => (
          <div key={item.nome} style={miniSectionStyle}>
            <h4>{item.nome}</h4>
            <p>
              <strong>{item.giornate}</strong> giornate pianificate
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

const sectionStyle = { width: "100%", boxSizing: "border-box", padding: "20px", marginBottom: "22px", borderRadius: "18px", backgroundColor: "#FFFFFF", border: "1.5px solid #2D2B28" };
const rankingGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "14px" };
const miniSectionStyle = { padding: "14px", borderRadius: "14px", backgroundColor: "#F7F5F2" };
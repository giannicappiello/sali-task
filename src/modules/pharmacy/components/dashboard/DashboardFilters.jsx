export default function DashboardFilters({
  dataDa,
  dataA,
  setDataDa,
  setDataA,
  farmaciaFiltro,
  setFarmaciaFiltro,
  beautyFiltro,
  setBeautyFiltro,
  farmacieConGiornate,
  beauty,
  utente,
}) {
  return (
    <div style={filtersPanelStyle}>
      <h3>Filtri periodo</h3>

      <div style={filtersStyle}>
        <label style={labelStyle}>Dal</label>
        <input
          style={inputStyle}
          type="date"
          value={dataDa}
          onChange={(e) => setDataDa(e.target.value)}
        />

        <label style={labelStyle}>Al</label>
        <input
          style={inputStyle}
          type="date"
          value={dataA}
          onChange={(e) => setDataA(e.target.value)}
        />

        <label style={labelStyle}>Farmacia</label>
        <select
          style={inputStyle}
          value={farmaciaFiltro}
          onChange={(e) => setFarmaciaFiltro(e.target.value)}
        >
          <option value="">Tutte</option>
          {farmacieConGiornate.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome} {f.citta ? `- ${f.citta}` : ""}
            </option>
          ))}
        </select>

        {utente?.ruolo === "admin" && (
          <>
            <label style={labelStyle}>Beauty</label>
            <select
              style={inputStyle}
              value={beautyFiltro}
              onChange={(e) => setBeautyFiltro(e.target.value)}
            >
              <option value="">Tutte</option>
              {beauty.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.cognome} {b.nome}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    </div>
  );
}

const filtersPanelStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "20px",
  marginBottom: "22px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
};

const filtersStyle = {
  display: "grid",
  gap: "10px",
  marginBottom: "20px",
  width: "100%",
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "13px",
  borderRadius: "12px",
  border: "1px solid #D8D1CB",
  fontSize: "15px",
};

const labelStyle = {
  color: "#6B645C",
  fontWeight: "600",
};
import { useEffect, useState } from "react";
import { supabase } from "../services/reportSupabase";
import CompilaReport from "./CompilaReport.jsx";

export default function Report({ utente }) {
  const [report, setReport] = useState([]);
  const [farmacie, setFarmacie] = useState([]);
  const [province, setProvince] = useState([]);
  const [beauty, setBeauty] = useState([]);
  const [vendite, setVendite] = useState([]);
  const [ricerca, setRicerca] = useState("");

  const [reportDettaglio, setReportDettaglio] = useState(null);
  const [reportModifica, setReportModifica] = useState(null);
  const solaLettura = utente?.ruolo === "agent";


  async function caricaDati() {
    let query = supabase
      .from("giornate_promozionali")
      .select("*")
      .eq("stato", "eseguita")
      .order("data", { ascending: true });

    if (utente?.ruolo === "beauty") {
      query = query.eq("consultant_id", utente.beauty_id);
    }

    const reportRes = await query;
    const farmacieRes = await supabase.from("farmacie").select("*");
    const provinceRes = await supabase.from("province").select("*");
    const beautyRes = await supabase.from("beauty_consultant").select("*");

    if (reportRes.error) return alert(reportRes.error.message);
    if (farmacieRes.error) return alert(farmacieRes.error.message);
    if (provinceRes.error) return alert(provinceRes.error.message);
    if (beautyRes.error) return alert(beautyRes.error.message);

    const reportData = reportRes.data || [];

    setReport(reportData);
    setFarmacie(farmacieRes.data || []);
    setProvince(provinceRes.data || []);
    setBeauty(beautyRes.data || []);

    const ids = reportData.map((r) => r.id);

    if (ids.length === 0) {
      setVendite([]);
      return;
    }

    const venditeRes = await supabase
      .from("vendite_prodotti")
      .select("*")
      .in("giornata_id", ids);

    if (venditeRes.error) return alert(venditeRes.error.message);

    setVendite(venditeRes.data || []);
  }

  useEffect(() => {
    caricaDati();
  }, []);

  function formatData(dataIso) {
    if (!dataIso) return "";
    const [anno, mese, giorno] = dataIso.split("-");
    return `${giorno}/${mese}/${anno.slice(2)}`;
  }

  function getFarmacia(id) {
    return farmacie.find((f) => f.id === id);
  }

  function getFarmaciaNome(id) {
    return getFarmacia(id)?.nome || "";
  }

  function getProvinciaLabel(farmaciaId) {
    const farmacia = getFarmacia(farmaciaId);
    const provincia = province.find((p) => p.id === farmacia?.provincia_id);
    return provincia ? `${provincia.nome} (${provincia.sigla})` : "";
  }

  function getBeautyNome(id, historicalName = "") {
    const b = beauty.find((item) => item.id === id);
    return b
      ? `${b.cognome || ""} ${b.nome || ""}`.trim()
      : historicalName || "";
  }

  function getVenditeReport(giornataId) {
    return vendite.filter((v) => v.giornata_id === giornataId);
  }

  const reportFiltrati = report.filter((r) => {
    const testo = `
      ${formatData(r.data)}
      ${getFarmaciaNome(r.farmacia_id)}
      ${getProvinciaLabel(r.farmacia_id)}
      ${getBeautyNome(r.consultant_id, r.consultant_nome_storico)}
      ${r.fatturato_giornata || ""}
    `.toLowerCase();

    return testo.includes(ricerca.toLowerCase());
  });

  async function eliminaReport(giornata) {
    const conferma = window.confirm(
      "Vuoi eliminare questo report? La giornata tornerà in stato pianificata."
    );

    if (!conferma) return;

    const { error: venditeError } = await supabase
      .from("vendite_prodotti")
      .delete()
      .eq("giornata_id", giornata.id);

    if (venditeError) return alert(venditeError.message);

    const { error: updateError } = await supabase
      .from("giornate_promozionali")
      .update({
        clienti_intervistati: null,
        clienti_interessati: null,
        clienti_acquistato: null,
        numero_tests_effettuati: null,
        feedback_clienti: null,
        motivi_non_interesse: null,
        numero_totale_pezzi_venduti: null,
        fatturato_giornata: null,
        note_finali: null,
        stato: "pianificata",
      })
      .eq("id", giornata.id);

    if (updateError) return alert(updateError.message);

    await caricaDati();
  }

  if (reportModifica) {
    return (
      <CompilaReport
        giornata={reportModifica}
        farmacie={farmacie}
        beauty={beauty}
        onBack={async () => {
          setReportModifica(null);
          await caricaDati();
        }}
      />
    );
  }

  if (reportDettaglio) {
    const venditeDettaglio = getVenditeReport(reportDettaglio.id);

    return (
      <div>
        <div style={headerStyle}>
          <h2>Dettaglio report</h2>
          <p style={subtitleStyle}>
            {formatData(reportDettaglio.data)} —{" "}
            {getFarmaciaNome(reportDettaglio.farmacia_id)}
          </p>
        </div>

        <button style={backButtonStyle} onClick={() => setReportDettaglio(null)}>
          ← Torna indietro
        </button>

        <div style={cardStyle}>
          <p><span style={labelStyle}>Data:</span> {formatData(reportDettaglio.data)}</p>
          <p><span style={labelStyle}>Farmacia:</span> {getFarmaciaNome(reportDettaglio.farmacia_id)}</p>
          <p><span style={labelStyle}>Provincia:</span> {getProvinciaLabel(reportDettaglio.farmacia_id)}</p>
          <p><span style={labelStyle}>Beauty:</span> {getBeautyNome(reportDettaglio.consultant_id, reportDettaglio.consultant_nome_storico)}</p>
          <p><span style={labelStyle}>Clienti intervistati:</span> {reportDettaglio.clienti_intervistati || 0}</p>
          <p><span style={labelStyle}>Clienti interessati:</span> {reportDettaglio.clienti_interessati || 0}</p>
          <p><span style={labelStyle}>Clienti acquistato:</span> {reportDettaglio.clienti_acquistato || 0}</p>
          <p><span style={labelStyle}>Test effettuati:</span> {reportDettaglio.numero_tests_effettuati || 0}</p>
          <p><span style={labelStyle}>Pezzi venduti:</span> {reportDettaglio.numero_totale_pezzi_venduti || 0}</p>
          <p><span style={labelStyle}>Fatturato:</span> € {Number(reportDettaglio.fatturato_giornata || 0).toFixed(2)}</p>

          {reportDettaglio.feedback_clienti && (
            <p><span style={labelStyle}>Feedback clienti:</span> {reportDettaglio.feedback_clienti}</p>
          )}

          {reportDettaglio.motivi_non_interesse && (
            <p><span style={labelStyle}>Motivi non interesse:</span> {reportDettaglio.motivi_non_interesse}</p>
          )}

          {reportDettaglio.note_finali && (
            <p><span style={labelStyle}>Note finali:</span> {reportDettaglio.note_finali}</p>
          )}
        </div>

        <h3 style={sectionTitleStyle}>Prodotti venduti</h3>

        <div style={listStyle}>
          {venditeDettaglio.length === 0 && (
            <div style={cardStyle}>Nessun prodotto venduto registrato.</div>
          )}

          {venditeDettaglio.map((v) => (
            <div key={v.id} style={cardStyle}>
              <h3>{v.nome_prodotto}</h3>
              <p><span style={labelStyle}>Categoria:</span> {v.categoria_prodotto || "-"}</p>
              <p><span style={labelStyle}>Sottocategoria:</span> {v.sottocategoria_prodotto || "-"}</p>
              <p><span style={labelStyle}>Quantità:</span> {v.quantita}</p>
              <p><span style={labelStyle}>Prezzo unitario:</span> € {Number(v.prezzo_unitario || 0).toFixed(2)}</p>
              <p><span style={labelStyle}>Totale:</span> € {Number(v.valore_totale || 0).toFixed(2)}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={headerStyle}>
        <h2>Report</h2>
        <p style={subtitleStyle}>Elenco report giornate eseguite</p>
      </div>

      <input
        style={searchStyle}
        placeholder="Ricerca rapida report..."
        value={ricerca}
        onChange={(e) => setRicerca(e.target.value)}
      />

      <div style={listStyle}>
        {reportFiltrati.map((r) => (
          <div key={r.id} style={cardStyle}>
            <h3>{getFarmaciaNome(r.farmacia_id)}</h3>

            <p><span style={labelStyle}>Data:</span> {formatData(r.data)}</p>
            <p><span style={labelStyle}>Provincia:</span> {getProvinciaLabel(r.farmacia_id)}</p>
            <p><span style={labelStyle}>Beauty:</span> {getBeautyNome(r.consultant_id, r.consultant_nome_storico)}</p>
            <p><span style={labelStyle}>Fatturato:</span> € {Number(r.fatturato_giornata || 0).toFixed(2)}</p>

            <div style={actionRowStyle}>
               <button
                  style={viewButtonStyle}
                 onClick={() => setReportDettaglio(r)}
                >
                  Visualizza
                </button>

              {!solaLettura && (
                <>
                  <button
                    style={editButtonStyle}
                    onClick={() => setReportModifica(r)}
                  >
                    Modifica
                  </button>

                  <button
                    style={deleteButtonStyle}
                    onClick={() => eliminaReport(r)}
                  >
        Elimina
      </button>
    </>
  )}
</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const headerStyle = {
  marginBottom: "22px",
  textAlign: "center",
};

const subtitleStyle = {
  fontSize: "14px",
  color: "#6B645C",
};

const searchStyle = {
  width: "100%",
  padding: "15px",
  marginBottom: "18px",
  borderRadius: "14px",
  border: "1.5px solid #2D2B28",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  fontSize: "15px",
};

const listStyle = {
  display: "grid",
  gap: "16px",
};

const cardStyle = {
  padding: "20px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
  lineHeight: "1.6",
};

const labelStyle = {
  color: "#6B645C",
  fontWeight: "600",
};

const actionRowStyle = {
  display: "flex",
  gap: "10px",
  marginTop: "16px",
  flexWrap: "wrap",
};

const viewButtonStyle = {
  flex: 1,
  minWidth: "100px",
  padding: "10px 16px",
  border: "1px solid #2D2B28",
  borderRadius: "12px",
  backgroundColor: "#2D2B28",
  color: "#FFFFFF",
  fontWeight: "600",
  cursor: "pointer",
};

const editButtonStyle = {
  flex: 1,
  minWidth: "100px",
  padding: "10px 16px",
  border: "1px solid #B8ADA4",
  borderRadius: "12px",
  backgroundColor: "#F7F5F2",
  color: "#2D2B28",
  fontWeight: "600",
  cursor: "pointer",
};

const deleteButtonStyle = {
  flex: 1,
  minWidth: "100px",
  padding: "10px 16px",
  border: "1px solid #8B0000",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  color: "#8B0000",
  fontWeight: "600",
  cursor: "pointer",
};

const backButtonStyle = {
  width: "100%",
  padding: "13px",
  marginBottom: "16px",
  border: "1.5px solid #2D2B28",
  borderRadius: "14px",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  fontWeight: "600",
  cursor: "pointer",
};

const sectionTitleStyle = {
  margin: "24px 0 14px",
};
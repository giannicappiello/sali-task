import { useEffect, useState } from "react";
import { supabase } from "../services/reportSupabase";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export default function CompilaReport({ giornata, farmacie, beauty, onBack }) {
  const [prodotti, setProdotti] = useState([]);
  const [sottocategorie, setSottocategorie] = useState([]);
  const [vendite, setVendite] = useState([]);

  const [clientiIntervistati, setClientiIntervistati] = useState("");
  const [clientiInteressati, setClientiInteressati] = useState("");
  const [clientiAcquistato, setClientiAcquistato] = useState("");
  const [numeroTests, setNumeroTests] = useState("");
  const [feedbackClienti, setFeedbackClienti] = useState("");
  const [motiviNonInteresse, setMotiviNonInteresse] = useState("");
  const [noteFinali, setNoteFinali] = useState("");

  useEffect(() => {
    caricaDati();
  }, []);

  async function caricaDati() {
    const prodottiRes = await supabase
      .from("prodotti")
      .select("*")
      .eq("attivo", true)
      .order("codice", { ascending: true });

    const sottocategorieRes = await supabase
      .from("sottocategorie_prodotti")
      .select("*")
      .order("nome", { ascending: true });

    const venditeRes = await supabase
      .from("vendite_prodotti")
      .select("*")
      .eq("giornata_id", giornata.id);

    if (prodottiRes.error) return alert(prodottiRes.error.message);
    if (sottocategorieRes.error) return alert(sottocategorieRes.error.message);
    if (venditeRes.error) return alert(venditeRes.error.message);

    setProdotti(prodottiRes.data || []);
    setSottocategorie(sottocategorieRes.data || []);

    setClientiIntervistati(giornata.clienti_intervistati || "");
    setClientiInteressati(giornata.clienti_interessati || "");
    setClientiAcquistato(giornata.clienti_acquistato || "");
    setNumeroTests(giornata.numero_tests_effettuati || "");
    setFeedbackClienti(giornata.feedback_clienti || "");
    setMotiviNonInteresse(giornata.motivi_non_interesse || "");
    setNoteFinali(giornata.note_finali || "");

    setVendite(
      (venditeRes.data || []).map((v) => ({
        prodotto_id: v.prodotto_id || "",
        codice_prodotto: v.codice_prodotto || "",
        ricerca_prodotto: v.codice_prodotto
          ? `${v.codice_prodotto} - ${v.nome_prodotto || ""}`
          : v.nome_prodotto || "",
        nome_prodotto: v.nome_prodotto || "",
        categoria_prodotto: v.categoria_prodotto || "",
        sottocategoria_prodotto: v.sottocategoria_prodotto || "",
        prezzo_unitario: Number(v.prezzo_unitario || 0),
        quantita: Number(v.quantita || 1),
      }))
    );
  }

  function getFarmaciaNome(id) {
    return farmacie.find((f) => f.id === id)?.nome || "";
  }

  function getBeautyNome(id) {
    const b = beauty.find((item) => item.id === id);
    if (b) return `${b.cognome || ""} ${b.nome || ""}`.trim();
    return giornata.consultant_nome_storico || "";
  }

  function getSottocategoriaNome(id) {
    return sottocategorie.find((s) => s.id === id)?.nome || "";
  }

  function formatDataIt(dataIso) {
    if (!dataIso) return "-";
    const [anno, mese, giorno] = dataIso.split("-");
    return `${giorno}/${mese}/${anno}`;
  }

  function aggiungiVendita() {
    setVendite([
      ...vendite,
      {
        prodotto_id: "",
        codice_prodotto: "",
        ricerca_prodotto: "",
        nome_prodotto: "",
        categoria_prodotto: "",
        sottocategoria_prodotto: "",
        prezzo_unitario: 0,
        quantita: 1,
      },
    ]);
  }

  function aggiornaRicercaProdotto(index, valore) {
    const nuoveVendite = [...vendite];
    nuoveVendite[index].ricerca_prodotto = valore;
    setVendite(nuoveVendite);
  }

  function prodottiFiltratiPerRiga(index) {
    const ricerca = (vendite[index]?.ricerca_prodotto || "").toLowerCase();

    if (!ricerca) return prodotti.slice(0, 20);

    return prodotti
      .filter((p) => {
        const testo = `${p.codice || ""} ${p.nome || ""}`.toLowerCase();
        return testo.includes(ricerca);
      })
      .slice(0, 20);
  }

  function aggiornaProdotto(index, prodottoId) {
    const prodotto = prodotti.find((p) => p.id === prodottoId);
    const nuoveVendite = [...vendite];

    nuoveVendite[index] = {
      ...nuoveVendite[index],
      prodotto_id: prodottoId,
      codice_prodotto: prodotto?.codice || "",
      ricerca_prodotto: prodotto
        ? `${prodotto.codice || ""} - ${prodotto.nome || ""}`
        : "",
      nome_prodotto: prodotto?.nome || "",
      categoria_prodotto: prodotto?.categoria || "",
      sottocategoria_prodotto: getSottocategoriaNome(
        prodotto?.sottocategoria_id
      ),
      prezzo_unitario: Number(prodotto?.prezzo || 0),
    };

    setVendite(nuoveVendite);
  }

  function aggiornaQuantita(index, quantita) {
    const nuoveVendite = [...vendite];
    nuoveVendite[index].quantita = Number(quantita);
    setVendite(nuoveVendite);
  }

  function rimuoviVendita(index) {
    setVendite(vendite.filter((_, i) => i !== index));
  }

  const totalePezzi = vendite.reduce(
    (totale, vendita) => totale + Number(vendita.quantita || 0),
    0
  );

  const fatturatoTotale = vendite.reduce(
    (totale, vendita) =>
      totale +
      Number(vendita.prezzo_unitario || 0) * Number(vendita.quantita || 0),
    0
  );

  async function salvaReport(e) {
    e.preventDefault();

    const { error: deleteOldVenditeError } = await supabase
      .from("vendite_prodotti")
      .delete()
      .eq("giornata_id", giornata.id);

    if (deleteOldVenditeError) return alert(deleteOldVenditeError.message);

    const { error: updateError } = await supabase
      .from("giornate_promozionali")
      .update({
        clienti_intervistati: clientiIntervistati || 0,
        clienti_interessati: clientiInteressati || 0,
        clienti_acquistato: clientiAcquistato || 0,
        numero_tests_effettuati: numeroTests || 0,
        feedback_clienti: feedbackClienti,
        motivi_non_interesse: motiviNonInteresse,
        numero_totale_pezzi_venduti: totalePezzi,
        fatturato_giornata: fatturatoTotale,
        note_finali: noteFinali,
        stato: "eseguita",
      })
      .eq("id", giornata.id);

    if (updateError) return alert(updateError.message);

    const righeVendite = vendite
      .filter((v) => v.prodotto_id)
      .map((v) => ({
        giornata_id: giornata.id,
        prodotto_id: v.prodotto_id,
        codice_prodotto: v.codice_prodotto,
        nome_prodotto: v.nome_prodotto,
        categoria_prodotto: v.categoria_prodotto,
        sottocategoria_prodotto: v.sottocategoria_prodotto,
        prezzo_unitario: v.prezzo_unitario,
        quantita: v.quantita,
        valore_totale:
          Number(v.prezzo_unitario || 0) * Number(v.quantita || 0),
      }));

    if (righeVendite.length > 0) {
      const { error: venditeError } = await supabase
        .from("vendite_prodotti")
        .insert(righeVendite);

      if (venditeError) return alert(venditeError.message);
    }

    alert("Report salvato correttamente");
    onBack();
  }

  async function generaPDF() {
    const doc = new jsPDF();

    async function caricaLogo() {
      try {
        const response = await fetch("/logo.png");
        const blob = await response.blob();

        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    }

    const logo = await caricaLogo();

    if (logo) {
      doc.addImage(logo, "PNG", 10, 10, 30, 30);
    }

    doc.setTextColor("#2D2B28");
    doc.setFontSize(20);
    doc.text("Report Giornata Promozionale", 196, 30, { align: "right" });

    
    doc.setFontSize(12);
    
    doc.setLineWidth(0.5);
    doc.setDrawColor(150, 150, 150);
      doc.line(14, 67, 196, 67);

    const farmaciaText = doc.splitTextToSize(
       getFarmaciaNome(giornata.farmacia_id),
        140
      );
    doc.text(farmaciaText, 196, 38, { align: "right" });

    doc.setTextColor("#6B645C");
    doc.setFontSize(14);
    doc.text(`Beauty Consultant: ${getBeautyNome(giornata.consultant_id)}`, 14, 57);
    doc.setFontSize(11);
    doc.text(`Data: ${formatDataIt(giornata.data)}`, 14, 62);
    doc.text(`Ora inizio: ${giornata.ora_inizio || "-"}`, 160, 57);
    doc.text(`Ora fine: ${giornata.ora_fine || "-"}`, 160, 62);

    doc.setTextColor("#000000");
    doc.setFontSize(13);
    doc.text("KPI giornata", 14, 74);

    doc.setTextColor("#6B645C");
    doc.setFontSize(11);
    doc.text(`Clienti intervistati: ${clientiIntervistati || 0}`, 14, 81);
    doc.text(`Clienti interessati: ${clientiInteressati || 0}`, 14, 85);
    doc.text(`Clienti che hanno acquistato: ${clientiAcquistato || 0}`, 65, 81);
    doc.text(`Numero test effettuati: ${numeroTests || 0}`, 65, 85);

    autoTable(doc, {
      startY: 96,
      head: [["Codice", "Prodotto", "Qtà", "Prezzo", "Totale"]],
      body: vendite.map((v) => [
        v.codice_prodotto || "-",
        v.nome_prodotto || "-",
        v.quantita || 0,
        `€ ${Number(v.prezzo_unitario || 0).toFixed(2)}`,
        `€ ${(Number(v.prezzo_unitario || 0) * Number(v.quantita || 0)).toFixed(2)}`,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [45, 43, 40] },
    });

    let y = doc.lastAutoTable.finalY + 12;

    if (y > 250) {
      doc.addPage();
      y = 20;
    }

    doc.setFontSize(12);
    doc.text(`Totale pezzi: ${totalePezzi}`, 196, y, { align: "right" });
    doc.text(`Fatturato totale: € ${fatturatoTotale.toFixed(2)}`, 196, y + 7, { align: "right" });

    y += 7;

    if (y > 250) {
      doc.addPage();
      y = 22;
    }

    doc.setFontSize(12);
    doc.text("Feedback clienti:", 14, y);
    doc.setFontSize(10);
    doc.text(doc.splitTextToSize(feedbackClienti || "-", 180), 14, y + 7);

    y += 38;

    if (y > 250) {
      doc.addPage();
      y = 20;
    }

    doc.setFontSize(12);
    doc.text("Motivi di non interesse:", 14, y);
    doc.setFontSize(10);
    doc.text(doc.splitTextToSize(motiviNonInteresse || "-", 180), 14, y + 7);

    y += 38;

    if (y > 250) {
      doc.addPage();
      y = 20;
    }

    doc.setFontSize(12);
    doc.text("Note finali:", 14, y);
    doc.setFontSize(10);
    doc.text(doc.splitTextToSize(noteFinali || "-", 180), 14, y + 7);

    const nomeFarmacia = getFarmaciaNome(giornata.farmacia_id)
      .replaceAll(" ", "_")
      .replaceAll("/", "-");

    doc.save(`report-${nomeFarmacia}-${giornata.data}.pdf`);
  }

  async function eliminaReport() {
    const conferma = window.confirm(
      "Vuoi eliminare il report di questa giornata? La giornata tornerà in stato pianificata."
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

    alert("Report eliminato correttamente");
    onBack();
  }

  return (
    <div>
      <div style={headerStyle}>
        <h2>
          {giornata.stato === "eseguita" ? "Modifica report" : "Compila report"}
        </h2>
        <p style={subtitleStyle}>
          {getFarmaciaNome(giornata.farmacia_id)} —{" "}
          {getBeautyNome(giornata.consultant_id)}
        </p>
      </div>

      <div style={formWrapperStyle}>
        <form onSubmit={salvaReport} style={formStyle}>
          <button type="button" style={backButtonStyle} onClick={onBack}>
            ← Torna indietro
          </button>

          <label style={labelStyle}>Clienti intervistati</label>
          <input
            style={inputStyle}
            type="number"
            value={clientiIntervistati}
            onChange={(e) => setClientiIntervistati(e.target.value)}
          />

          <label style={labelStyle}>Clienti interessati</label>
          <input
            style={inputStyle}
            type="number"
            value={clientiInteressati}
            onChange={(e) => setClientiInteressati(e.target.value)}
          />

          <label style={labelStyle}>Clienti che hanno acquistato</label>
          <input
            style={inputStyle}
            type="number"
            value={clientiAcquistato}
            onChange={(e) => setClientiAcquistato(e.target.value)}
          />

          <label style={labelStyle}>Numero test effettuati</label>
          <input
            style={inputStyle}
            type="number"
            value={numeroTests}
            onChange={(e) => setNumeroTests(e.target.value)}
          />

          <label style={labelStyle}>Feedback clienti</label>
          <textarea
            style={textareaStyle}
            value={feedbackClienti}
            onChange={(e) => setFeedbackClienti(e.target.value)}
          />

          <label style={labelStyle}>Motivi di non interesse</label>
          <textarea
            style={textareaStyle}
            value={motiviNonInteresse}
            onChange={(e) => setMotiviNonInteresse(e.target.value)}
          />

          <h3>Prodotti venduti</h3>

          {vendite.map((vendita, index) => (
            <div key={index} style={venditaStyle}>
              <label style={labelStyle}>Cerca prodotto</label>

              <input
                style={inputStyle}
                placeholder="Digita codice o nome prodotto..."
                value={vendita.ricerca_prodotto || ""}
                onChange={(e) =>
                  aggiornaRicercaProdotto(index, e.target.value)
                }
              />

              {vendita.ricerca_prodotto && (
                <div style={productSearchListStyle}>
                  {prodottiFiltratiPerRiga(index).map((prodotto) => (
                    <button
                      key={prodotto.id}
                      type="button"
                      style={productSearchItemStyle}
                      onClick={() => aggiornaProdotto(index, prodotto.id)}
                    >
                      <strong>{prodotto.codice}</strong> — {prodotto.nome}
                    </button>
                  ))}
                </div>
              )}

              <p>
                <span style={labelStyle}>Categoria:</span>{" "}
                {vendita.categoria_prodotto || "-"}
              </p>
              <p>
                <span style={labelStyle}>Sottocategoria:</span>{" "}
                {vendita.sottocategoria_prodotto || "-"}
              </p>
              <p>
                <span style={labelStyle}>Prezzo unitario:</span> €{" "}
                {Number(vendita.prezzo_unitario || 0).toFixed(2)}
              </p>

              <label style={labelStyle}>Quantità</label>
              <input
                style={inputStyle}
                type="number"
                min="1"
                value={vendita.quantita}
                onChange={(e) => aggiornaQuantita(index, e.target.value)}
              />

              <p>
                <span style={labelStyle}>Totale riga:</span> €{" "}
                {(
                  Number(vendita.prezzo_unitario || 0) *
                  Number(vendita.quantita || 0)
                ).toFixed(2)}
              </p>

              <button
                type="button"
                style={deleteButtonStyle}
                onClick={() => rimuoviVendita(index)}
              >
                Rimuovi prodotto
              </button>
            </div>
          ))}

          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={aggiungiVendita}
          >
            + Aggiungi prodotto
          </button>

          <div style={summaryStyle}>
            <p>
              <span style={labelStyle}>Totale pezzi:</span> {totalePezzi}
            </p>
            <p>
              <span style={labelStyle}>Fatturato totale:</span> €{" "}
              {fatturatoTotale.toFixed(2)}
            </p>
          </div>

          <label style={labelStyle}>Note finali</label>
          <textarea
            style={textareaStyle}
            value={noteFinali}
            onChange={(e) => setNoteFinali(e.target.value)}
          />

          <button style={saveButtonStyle} type="submit">
            Salva report
          </button>

          <button type="button" style={secondaryButtonStyle} onClick={generaPDF}>
            Genera PDF Report
          </button>

          {giornata.stato === "eseguita" && (
            <button
              type="button"
              style={deleteReportButtonStyle}
              onClick={eliminaReport}
            >
              Elimina report
            </button>
          )}
        </form>
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
  marginTop: "6px",
};

const formWrapperStyle = {
  width: "100%",
  maxWidth: "720px",
  margin: "0 auto",
  boxSizing: "border-box",
};

const formStyle = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  display: "grid",
  gap: "12px",
  padding: "20px",
  marginBottom: "24px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
  overflowX: "hidden",
};

const inputStyle = {
  display: "block",
  width: "100%",
  maxWidth: "100%",
  minWidth: "0",
  boxSizing: "border-box",
  padding: "12px",
  borderRadius: "12px",
  border: "1px solid #D8D1CB",
  fontSize: "15px",
};

const textareaStyle = {
  ...inputStyle,
  minHeight: "110px",
  resize: "vertical",
};

const backButtonStyle = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  padding: "13px",
  marginBottom: "4px",
  border: "1.5px solid #2D2B28",
  borderRadius: "14px",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  fontWeight: "600",
  cursor: "pointer",
};

const secondaryButtonStyle = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  padding: "13px",
  border: "1.5px solid #2D2B28",
  borderRadius: "14px",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  fontWeight: "600",
  cursor: "pointer",
};

const saveButtonStyle = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  padding: "15px",
  border: "1px solid #2D2B28",
  borderRadius: "16px",
  backgroundColor: "#2D2B28",
  color: "#FFFFFF",
  fontSize: "16px",
  fontWeight: "600",
  cursor: "pointer",
};

const venditaStyle = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  padding: "15px",
  borderRadius: "14px",
  border: "1px solid #D8D1CB",
  backgroundColor: "#F7F5F2",
  display: "grid",
  gap: "8px",
  overflowX: "hidden",
};

const summaryStyle = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  padding: "15px",
  borderRadius: "14px",
  border: "1.5px solid #2D2B28",
  backgroundColor: "#FFFFFF",
};

const labelStyle = {
  color: "#6B645C",
  fontWeight: "600",
};

const deleteButtonStyle = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  padding: "10px",
  border: "1px solid #8B0000",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  color: "#8B0000",
  fontWeight: "600",
  cursor: "pointer",
};

const deleteReportButtonStyle = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  padding: "13px",
  border: "1px solid #8B0000",
  borderRadius: "14px",
  backgroundColor: "#FFFFFF",
  color: "#8B0000",
  fontWeight: "600",
  cursor: "pointer",
};

const productSearchListStyle = {
  display: "grid",
  gap: "6px",
  padding: "8px",
  borderRadius: "12px",
  border: "1px solid #D8D1CB",
  backgroundColor: "#FFFFFF",
};

const productSearchItemStyle = {
  width: "100%",
  padding: "10px",
  border: "1px solid #D8D1CB",
  borderRadius: "10px",
  backgroundColor: "#F7F5F2",
  color: "#2D2B28",
  textAlign: "left",
  cursor: "pointer",
};
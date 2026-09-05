import { useCallback, useEffect, useState } from "react";
import { supabase as reportSupabase } from "../services/reportSupabase";
import { supabase as primarySupabase } from "../../../lib/supabaseClient";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { googleMapsCoordinateUrl } from "../services/beautyVisitCrm";

export default function CompilaReport({
  giornata,
  farmacie,
  beauty,
  visit: initialVisit = null,
  checkoutContext = null,
  onCompleteCheckout = null,
  onBack,
}) {
  const isCrmOnly = Boolean(giornata._crmOnly && giornata.crm_activity_id);
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
  const [crmReportData, setCrmReportData] = useState({});
  const [hasExistingReport, setHasExistingReport] = useState(false);
  const [visitDetails, setVisitDetails] = useState(initialVisit);
  const [visitActivity, setVisitActivity] = useState(null);
  const [nextActivity, setNextActivity] = useState(null);
  const [planningMode, setPlanningMode] = useState(false);
  const [nextType, setNextType] = useState("follow_up");
  const [nextTopic, setNextTopic] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [visitOutcome, setVisitOutcome] = useState("");
  const [planningBusy, setPlanningBusy] = useState(false);

  const caricaDati = useCallback(async () => {
    const prodottiRes = await primarySupabase
      .from("prodotti")
      .select("*")
      .eq("attivo_mexal", true)
      .eq("mostra_in_app", true)
      .like("codice_mexal", "IT%")
      .order("codice_mexal", { ascending: true });

    const sottocategorieRes = await reportSupabase
      .from("sottocategorie_prodotti")
      .select("*")
      .order("nome", { ascending: true });

    const activityId = giornata.crm_activity_id || initialVisit?.activity_id || null;
    const venditeRes = isCrmOnly
      ? await primarySupabase.from("crm_visit_details").select("*").eq("activity_id", activityId).single()
      : await reportSupabase.from("vendite_prodotti").select("*").eq("giornata_id", giornata.id);

    if (activityId) {
      const [detailsRes, activityRes, nextRes] = await Promise.all([
        isCrmOnly
          ? Promise.resolve(venditeRes)
          : primarySupabase.from("crm_visit_details").select("*").eq("activity_id", activityId).maybeSingle(),
        primarySupabase
          .from("crm_activities")
          .select("titolo,descrizione,esito,prossima_azione,data_attivita,stato")
          .eq("id", activityId)
          .maybeSingle(),
        primarySupabase
          .from("crm_activities")
          .select("tipo,titolo,descrizione,data_attivita,stato")
          .eq("source_type", "beauty_visit")
          .eq("source_id", activityId)
          .order("data_attivita", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);
      if (detailsRes.error) return alert(detailsRes.error.message);
      if (activityRes.error) return alert(activityRes.error.message);
      if (nextRes.error) return alert(nextRes.error.message);
      setVisitDetails(detailsRes.data || initialVisit);
      setVisitActivity(activityRes.data || null);
      setNextActivity(nextRes.data || null);
    } else {
      setVisitDetails(initialVisit);
      setVisitActivity(null);
      setNextActivity(null);
    }

    if (prodottiRes.error) return alert(prodottiRes.error.message);
    if (sottocategorieRes.error) return alert(sottocategorieRes.error.message);
    if (venditeRes.error) return alert(venditeRes.error.message);

    setProdotti(prodottiRes.data || []);
    setSottocategorie(sottocategorieRes.data || []);

    const storedData = isCrmOnly ? (venditeRes.data?.report_data || {}) : {};
    const report = isCrmOnly ? (storedData.report || {}) : giornata;
    setCrmReportData(storedData);
    setHasExistingReport(isCrmOnly ? Boolean(storedData.report) : giornata.stato === "eseguita");
    setClientiIntervistati(report.clienti_intervistati || "");
    setClientiInteressati(report.clienti_interessati || "");
    setClientiAcquistato(report.clienti_acquistato || "");
    setNumeroTests(report.numero_tests_effettuati || "");
    setFeedbackClienti(report.feedback_clienti || "");
    setMotiviNonInteresse(report.motivi_non_interesse || "");
    setNoteFinali(report.note_finali || "");

    setVendite(
      (isCrmOnly ? (report.vendite || []) : (venditeRes.data || [])).map((v) => ({
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
  }, [giornata, initialVisit, isCrmOnly]);

  useEffect(() => {
    const timer = window.setTimeout(() => void caricaDati(), 0);
    return () => window.clearTimeout(timer);
  }, [caricaDati]);

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
        const testo = `${p.codice_mexal || p.codice || ""} ${p.nome || ""}`.toLowerCase();
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
      codice_prodotto: prodotto?.codice_mexal || prodotto?.codice || "",
      ricerca_prodotto: prodotto
        ? `${prodotto.codice_mexal || prodotto.codice || ""} - ${prodotto.nome || ""}`
        : "",
      nome_prodotto: prodotto?.nome || "",
      categoria_prodotto: prodotto?.categoria_mexal || prodotto?.categoria || "",
      sottocategoria_prodotto:
        prodotto?.sottocategoria_mexal ||
        prodotto?.sottocategoria ||
        getSottocategoriaNome(prodotto?.sottocategoria_id),
      prezzo_unitario: Number(prodotto?.prezzo_listino || prodotto?.prezzo || 0),
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

  const effectiveVisit = checkoutContext
    ? {
        ...(visitDetails || {}),
        check_out_at: checkoutContext.capturedAt,
        check_out_latitude: checkoutContext.position?.latitude,
        check_out_longitude: checkoutContext.position?.longitude,
        check_out_accuracy_meters: checkoutContext.position?.accuracy,
      }
    : visitDetails;

  function reportSaved() {
    setHasExistingReport(true);
    if (checkoutContext && onCompleteCheckout) {
      setPlanningMode(true);
      return;
    }
    alert("Report salvato correttamente");
    onBack();
  }

  async function salvaReport(e) {
    e.preventDefault();
    if (checkoutContext && !noteFinali.trim()) {
      alert("Le note finali sono obbligatorie per completare il check-out.");
      return;
    }

    const righeVendite = vendite
      .filter((v) => v.codice_prodotto)
      .map((v) => ({
        prodotto_id: null,
        codice_prodotto: v.codice_prodotto,
        nome_prodotto: v.nome_prodotto,
        categoria_prodotto: v.categoria_prodotto,
        sottocategoria_prodotto: v.sottocategoria_prodotto,
        prezzo_unitario: Number(v.prezzo_unitario || 0),
        quantita: Number(v.quantita || 0),
        valore_totale: Number(v.prezzo_unitario || 0) * Number(v.quantita || 0),
      }));

    if (isCrmOnly) {
      const report = {
        clienti_intervistati: Number(clientiIntervistati || 0),
        clienti_interessati: Number(clientiInteressati || 0),
        clienti_acquistato: Number(clientiAcquistato || 0),
        numero_tests_effettuati: Number(numeroTests || 0),
        feedback_clienti: feedbackClienti,
        motivi_non_interesse: motiviNonInteresse,
        numero_totale_pezzi_venduti: totalePezzi,
        fatturato_giornata: fatturatoTotale,
        note_finali: noteFinali,
        vendite: righeVendite,
        saved_at: new Date().toISOString(),
      };
      const { error } = await primarySupabase
        .from("crm_visit_details")
        .update({ report_data: { ...crmReportData, report } })
        .eq("activity_id", giornata.crm_activity_id);
      if (error) return alert(error.message);
      reportSaved();
      return;
    }

    const { error: deleteOldVenditeError } = await reportSupabase
      .from("vendite_prodotti")
      .delete()
      .eq("giornata_id", giornata.id);

    if (deleteOldVenditeError) return alert(deleteOldVenditeError.message);

    const { error: updateError } = await reportSupabase
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

    const righeVenditeLegacy = righeVendite.map((v) => ({
        giornata_id: giornata.id,
        ...v,
      }));

    if (righeVenditeLegacy.length > 0) {
      const { error: venditeError } = await reportSupabase
        .from("vendite_prodotti")
        .insert(righeVenditeLegacy);

      if (venditeError) return alert(venditeError.message);
    }

    reportSaved();
  }

  async function confermaPianificazione(e) {
    e.preventDefault();
    if (!visitOutcome.trim() || !nextType || !nextTopic.trim() || !nextDate) {
      alert("Esito, tipo, argomento e data della prossima attività sono obbligatori.");
      return;
    }
    setPlanningBusy(true);
    try {
      await onCompleteCheckout({
        outcome: visitOutcome.trim(),
        nextType,
        nextTopic: nextTopic.trim(),
        nextAt: `${nextDate}T09:00:00`,
      });
    } finally {
      setPlanningBusy(false);
    }
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
    const conferma = await window.workspaceConfirm(
      "Vuoi eliminare il report di questa giornata? La giornata tornerà in stato pianificata."
    );

    if (!conferma) return;

    if (isCrmOnly) {
      const preservedData = Object.fromEntries(
        Object.entries(crmReportData).filter(([key]) => key !== "report")
      );
      const { error } = await primarySupabase
        .from("crm_visit_details")
        .update({ report_data: preservedData })
        .eq("activity_id", giornata.crm_activity_id);
      if (error) return alert(error.message);
      alert("Report eliminato correttamente");
      onBack();
      return;
    }

    const { error: venditeError } = await reportSupabase
      .from("vendite_prodotti")
      .delete()
      .eq("giornata_id", giornata.id);

    if (venditeError) return alert(venditeError.message);

    const { error: updateError } = await reportSupabase
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

  if (planningMode) {
    return (
      <div>
        <div style={headerStyle}>
          <h2>Pianifica l'attività successiva</h2>
          <p style={subtitleStyle}>Il report è salvato. Completa la pianificazione per terminare il check-out.</p>
        </div>
        <div style={formWrapperStyle}>
          <form onSubmit={confermaPianificazione} style={formStyle}>
            <VisitReportSummary giornata={giornata} visit={effectiveVisit} activity={visitActivity} nextActivity={null} pendingCheckout />
            <label style={labelStyle}>Esito della visita *</label>
            <input style={inputStyle} required value={visitOutcome} onChange={(e) => setVisitOutcome(e.target.value)} placeholder="Esito della visita" />
            <label style={labelStyle}>Tipo attività successiva *</label>
            <select style={inputStyle} required value={nextType} onChange={(e) => setNextType(e.target.value)}>
              <option value="follow_up">Follow-up</option>
              <option value="telefonata">Telefonata</option>
              <option value="visita">Visita</option>
              <option value="email">Email</option>
              <option value="presentazione">Presentazione</option>
              <option value="formazione">Formazione</option>
            </select>
            <label style={labelStyle}>Argomento *</label>
            <textarea style={textareaStyle} required value={nextTopic} onChange={(e) => setNextTopic(e.target.value)} placeholder="Indica l'argomento della prossima attività" />
            <label style={labelStyle}>Data attività successiva *</label>
            <input style={inputStyle} required type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
            <button style={saveButtonStyle} type="submit" disabled={planningBusy}>
              {planningBusy ? "Registrazione..." : "Conferma pianificazione e completa check-out"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={headerStyle}>
        <h2>
          {hasExistingReport ? "Visualizza / modifica report" : "Compila report"}
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

          <VisitReportSummary
            giornata={giornata}
            visit={effectiveVisit}
            activity={visitActivity}
            nextActivity={nextActivity}
            pendingCheckout={Boolean(checkoutContext)}
          />

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
            required={Boolean(checkoutContext)}
            value={noteFinali}
            onChange={(e) => setNoteFinali(e.target.value)}
          />
          {checkoutContext && <small>Campo obbligatorio per completare il check-out.</small>}

          <button style={saveButtonStyle} type="submit">
            Salva report
          </button>

          <button type="button" style={secondaryButtonStyle} onClick={generaPDF}>
            Genera PDF Report
          </button>

          {hasExistingReport && (
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

function VisitReportSummary({ giornata, visit, activity, nextActivity, pendingCheckout = false }) {
  const hasVisitData = Boolean(visit || activity || giornata.note_operative || giornata.tipo_giornata);
  if (!hasVisitData) return null;
  return (
    <section style={visitSummaryStyle} aria-label="Dati e tracciamento della visita">
      <h3 style={visitSummaryTitleStyle}>Dati della visita</h3>
      <div style={visitInfoGridStyle}>
        <ReportInfo label="Tipo / argomento" value={giornata.tipo_giornata || activity?.titolo} />
        <ReportInfo label="Stato" value={visit?.visit_status || activity?.stato || giornata.stato} />
        <ReportInfo label="Esito" value={visit?.outcome || activity?.esito} />
        <ReportInfo label="Obiettivo vendite" value={giornata.obiettivo_vendite ? `€ ${giornata.obiettivo_vendite}` : null} />
        <ReportInfo label="Ora inizio" value={visit?.check_in_at ? formatDateTime(visit.check_in_at) : giornata.ora_inizio} />
        <ReportInfo label="Ora fine" value={visit?.check_out_at ? formatDateTime(visit.check_out_at) : giornata.ora_fine} />
      </div>
      {(giornata.note_operative || activity?.descrizione) && (
        <ReportInfo label="Argomenti / note operative" value={giornata.note_operative || activity?.descrizione} wide />
      )}
      {(nextActivity || activity?.prossima_azione) && (
        <ReportInfo
          label="Prossima attività"
          value={nextActivity
            ? `${nextActivity.tipo?.replaceAll("_", " ") || "Attività"}: ${nextActivity.titolo || activity?.prossima_azione}${nextActivity.data_attivita ? ` · ${formatDateTime(nextActivity.data_attivita, false)}` : ""}`
            : activity.prossima_azione}
          wide
        />
      )}
      {visit && (
        <div style={visitTrackingGridStyle}>
          <ReportPosition label="Check-in" at={visit.check_in_at} latitude={visit.check_in_latitude} longitude={visit.check_in_longitude} address={visit.check_in_address} accuracy={visit.check_in_accuracy_meters} distance={visit.check_in_distance_meters} geofence={visit.check_in_geofence} exceptionReason={visit.check_in_exception_reason} />
          <ReportPosition label="Check-out" at={visit.check_out_at} latitude={visit.check_out_latitude} longitude={visit.check_out_longitude} address={visit.check_out_address} accuracy={visit.check_out_accuracy_meters} distance={visit.check_out_distance_meters} geofence={visit.check_out_geofence} exceptionReason={visit.check_out_exception_reason} />
        </div>
      )}
      {pendingCheckout && <small>Il check-out GPS sarà confermato dopo la pianificazione obbligatoria.</small>}
    </section>
  );
}

function ReportInfo({ label, value, wide = false }) {
  return (
    <div style={{ ...visitInfoStyle, ...(wide ? { gridColumn: "1 / -1" } : {}) }}>
      <strong>{label}</strong>
      <span>{value || "Non indicato"}</span>
    </div>
  );
}

function ReportPosition({ label, at, latitude, longitude, address, accuracy, distance, geofence, exceptionReason }) {
  const hasCoordinates = Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
  return (
    <div style={visitPositionStyle}>
      <strong>{label}</strong>
      <span>{at ? formatDateTime(at) : "Non registrato"}</span>
      {address && <span>Indirizzo rilevato: {address}</span>}
      {distance != null && <span>Distanza dalla sede: {Number(distance).toFixed(0)} m</span>}
      {accuracy != null && <span>Precisione GPS: ±{Number(accuracy).toFixed(0)} m</span>}
      {geofence && <span>Esito geolocalizzazione: {String(geofence).replaceAll("_", " ")}</span>}
      {exceptionReason && <span>Motivazione: {exceptionReason}</span>}
      {hasCoordinates ? (
        <a href={googleMapsCoordinateUrl(latitude, longitude)} target="_blank" rel="noreferrer">
          Apri posizione sulla mappa
        </a>
      ) : at ? <span>Coordinate non disponibili o anonimizzate.</span> : null}
    </div>
  );
}

function formatDateTime(value, includeTime = true) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("it-IT", includeTime
    ? { dateStyle: "short", timeStyle: "short" }
    : { dateStyle: "short" });
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

const visitSummaryStyle = {
  display: "grid",
  gap: "12px",
  padding: "16px",
  border: "1px solid #D8E4F3",
  borderRadius: "14px",
  backgroundColor: "#F7FAFE",
};

const visitSummaryTitleStyle = { margin: 0, color: "#10243E" };

const visitInfoGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "10px",
};

const visitInfoStyle = {
  display: "grid",
  gap: "3px",
  minWidth: 0,
};

const visitTrackingGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
  gap: "10px",
};

const visitPositionStyle = {
  display: "grid",
  gap: "4px",
  padding: "12px",
  border: "1px solid #C9D9EC",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  overflowWrap: "anywhere",
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

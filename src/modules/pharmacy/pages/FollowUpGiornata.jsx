import { useEffect, useState } from "react";
import { supabase } from "../services/reportSupabase";

const tipiAzione = [
  "richiamare farmacia",
  "inviare materiale",
  "programmare nuova giornata",
  "verificare sell-out",
];

const statiFollowUp = ["da fare", "fatto", "rimandato"];

export default function FollowUpGiornata({
  giornata,
  farmacie,
  beauty,
  onBack,
}) {
  const [followUp, setFollowUp] = useState([]);
  const [tipoAzione, setTipoAzione] = useState("richiamare farmacia");
  const [stato, setStato] = useState("da fare");
  const [dataFollowup, setDataFollowup] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    caricaFollowUp();
  }, []);

  async function caricaFollowUp() {
    const { data, error } = await supabase
      .from("follow_up_giornate")
      .select("*")
      .eq("giornata_id", giornata.id)
      .order("created_at", { ascending: false });

    if (error) return alert(error.message);

    setFollowUp(data || []);
  }

  function getFarmaciaNome(id) {
    return farmacie.find((f) => f.id === id)?.nome || "Non indicata";
  }

  function getBeautyNome(id) {
    const b = beauty.find((item) => item.id === id);
    return b ? `${b.cognome || ""} ${b.nome || ""}`.trim() : "Non indicata";
  }

  function formatDataIt(dataIso) {
    if (!dataIso) return "-";
    const [anno, mese, giorno] = dataIso.split("-");
    return `${giorno}/${mese}/${anno}`;
  }

  async function aggiungiFollowUp(e) {
    e.preventDefault();

    const { error } = await supabase.from("follow_up_giornate").insert([
      {
        giornata_id: giornata.id,
        tipo_azione: tipoAzione,
        stato,
        data_followup: dataFollowup || null,
        note,
      },
    ]);

    if (error) return alert(error.message);

    setTipoAzione("richiamare farmacia");
    setStato("da fare");
    setDataFollowup("");
    setNote("");

    await caricaFollowUp();
  }

  async function aggiornaStato(item, nuovoStato) {
    const { error } = await supabase
      .from("follow_up_giornate")
      .update({ stato: nuovoStato })
      .eq("id", item.id);

    if (error) return alert(error.message);

    await caricaFollowUp();
  }

  async function eliminaFollowUp(item) {
    const conferma = window.confirm("Vuoi eliminare questa azione commerciale?");
    if (!conferma) return;

    const { error } = await supabase
      .from("follow_up_giornate")
      .delete()
      .eq("id", item.id);

    if (error) return alert(error.message);

    await caricaFollowUp();
  }

  return (
    <div>
      <div style={headerStyle}>
        <h2>Follow-up commerciale</h2>
        <p style={subtitleStyle}>
          {getFarmaciaNome(giornata.farmacia_id)} —{" "}
          {getBeautyNome(giornata.consultant_id)}
        </p>
      </div>

      <button style={backButtonStyle} onClick={onBack}>
        ← Torna indietro
      </button>

      <form style={formStyle} onSubmit={aggiungiFollowUp}>
        <h3>Nuova azione</h3>

        <label style={labelStyle}>Tipo azione</label>
        <select
          style={inputStyle}
          value={tipoAzione}
          onChange={(e) => setTipoAzione(e.target.value)}
        >
          {tipiAzione.map((tipo) => (
            <option key={tipo} value={tipo}>
              {tipo}
            </option>
          ))}
        </select>

        <label style={labelStyle}>Stato</label>
        <select
          style={inputStyle}
          value={stato}
          onChange={(e) => setStato(e.target.value)}
        >
          {statiFollowUp.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label style={labelStyle}>Data follow-up</label>
        <input
          style={inputStyle}
          type="date"
          value={dataFollowup}
          onChange={(e) => setDataFollowup(e.target.value)}
        />

        <label style={labelStyle}>Note</label>
        <textarea
          style={textareaStyle}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note operative..."
        />

        <button style={saveButtonStyle} type="submit">
          Aggiungi azione
        </button>
      </form>

      <div style={sectionStyle}>
        <h3>Azioni commerciali</h3>

        {followUp.length === 0 && <p>Nessuna azione commerciale presente.</p>}

        <div style={listStyle}>
          {followUp.map((item) => (
            <div key={item.id} style={cardStyle}>
              <h4>{item.tipo_azione}</h4>

              <p>
                <span style={labelStyle}>Stato:</span> {item.stato}
              </p>

              <p>
                <span style={labelStyle}>Data:</span>{" "}
                {formatDataIt(item.data_followup)}
              </p>

              {item.note && (
                <p>
                  <span style={labelStyle}>Note:</span> {item.note}
                </p>
              )}

              <label style={labelStyle}>Aggiorna stato</label>
              <select
                style={inputStyle}
                value={item.stato}
                onChange={(e) => aggiornaStato(item, e.target.value)}
              >
                {statiFollowUp.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              <button
                style={deleteButtonStyle}
                onClick={() => eliminaFollowUp(item)}
              >
                Elimina azione
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const headerStyle = {
  textAlign: "center",
  marginBottom: "22px",
};

const subtitleStyle = {
  fontSize: "14px",
  color: "#6B645C",
  marginTop: "6px",
};

const formStyle = {
  width: "100%",
  boxSizing: "border-box",
  display: "grid",
  gap: "12px",
  padding: "20px",
  marginBottom: "24px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
};

const sectionStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "20px",
  marginBottom: "22px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "13px",
  borderRadius: "12px",
  border: "1px solid #D8D1CB",
  fontSize: "15px",
};

const textareaStyle = {
  ...inputStyle,
  minHeight: "100px",
  resize: "vertical",
};

const labelStyle = {
  color: "#6B645C",
  fontWeight: "600",
};

const saveButtonStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "14px",
  border: "1px solid #2D2B28",
  borderRadius: "14px",
  backgroundColor: "#2D2B28",
  color: "#FFFFFF",
  fontWeight: "700",
  cursor: "pointer",
};

const backButtonStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "13px",
  marginBottom: "18px",
  border: "1.5px solid #2D2B28",
  borderRadius: "14px",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  fontWeight: "600",
  cursor: "pointer",
};

const listStyle = {
  display: "grid",
  gap: "12px",
};

const cardStyle = {
  padding: "16px",
  borderRadius: "14px",
  backgroundColor: "#F7F5F2",
  border: "1px solid #D8D1CB",
};

const deleteButtonStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px",
  marginTop: "12px",
  border: "1px solid #8B0000",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  color: "#8B0000",
  fontWeight: "600",
  cursor: "pointer",
};
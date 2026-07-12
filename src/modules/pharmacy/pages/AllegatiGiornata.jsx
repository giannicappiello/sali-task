import { useEffect, useState } from "react";
import { supabase } from "../services/reportSupabase";

const categorieAllegati = [
  { key: "foto_banco", label: "Foto banco" },
  { key: "foto_esposizione", label: "Foto esposizione" },
  { key: "materiali_vari", label: "Materiali vari" },
  { key: "competitor", label: "Competitor" },
  { key: "altro", label: "Altro" },
];

export default function AllegatiGiornata({ giornata, onBack }) {
  const [allegati, setAllegati] = useState([]);
  const [filePerCategoria, setFilePerCategoria] = useState({});
  const bucket = "allegati-giornate";

  useEffect(() => {
    caricaAllegati();
  }, []);

  async function caricaAllegati() {
    const { data, error } = await supabase
      .from("allegati_giornata")
      .select("*")
      .eq("giornata_id", giornata.id)
      .order("created_at", { ascending: false });

    if (error) return alert(error.message);
    setAllegati(data || []);
  }

  async function caricaFile(e, categoria) {
    e.preventDefault();

    const file = filePerCategoria[categoria];

    if (!file) {
      alert("Seleziona un file");
      return;
    }

    const filePath = `${giornata.id}/${categoria}/${Date.now()}-${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, file);

    if (uploadError) return alert(uploadError.message);

    const { error: insertError } = await supabase
      .from("allegati_giornata")
      .insert([
        {
          giornata_id: giornata.id,
          nome_file: file.name,
          path_file: filePath,
          tipo_file: file.type,
          categoria,
        },
      ]);

    if (insertError) return alert(insertError.message);

    setFilePerCategoria((prev) => ({ ...prev, [categoria]: null }));
    await caricaAllegati();
  }

  function getUrl(path) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  async function eliminaAllegato(allegato) {
    const conferma = window.confirm(`Vuoi eliminare "${allegato.nome_file}"?`);
    if (!conferma) return;

    await supabase.storage.from(bucket).remove([allegato.path_file]);

    const { error } = await supabase
      .from("allegati_giornata")
      .delete()
      .eq("id", allegato.id);

    if (error) return alert(error.message);

    await caricaAllegati();
  }

  function allegatiCategoria(categoria) {
    return allegati.filter((a) => (a.categoria || "altro") === categoria);
  }

  return (
    <div>
      <div style={headerStyle}>
        <h2>Allegati giornata</h2>
        <p style={subtitleStyle}>Foto e materiali organizzati per categoria</p>
      </div>

      <button style={backButtonStyle} onClick={onBack}>
        ← Torna indietro
      </button>

      <div style={listStyle}>
        {categorieAllegati.map((categoria) => {
          const allegatiFiltrati = allegatiCategoria(categoria.key);

          return (
            <div key={categoria.key} style={sectionStyle}>
              <h3>{categoria.label}</h3>

              <form
                onSubmit={(e) => caricaFile(e, categoria.key)}
                style={formStyle}
              >
                <input
                  style={inputStyle}
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) =>
                    setFilePerCategoria((prev) => ({
                      ...prev,
                      [categoria.key]: e.target.files[0],
                    }))
                  }
                />

                <button style={saveButtonStyle} type="submit">
                  Carica in {categoria.label}
                </button>
              </form>

              {allegatiFiltrati.length === 0 && (
                <p style={emptyTextStyle}>Nessun allegato presente.</p>
              )}

              <div style={galleryStyle}>
                {allegatiFiltrati.map((allegato) => (
                  <div key={allegato.id} style={cardStyle}>
                    <p>
                      <span style={labelStyle}>File:</span>{" "}
                      {allegato.nome_file}
                    </p>

                    {allegato.tipo_file?.startsWith("image/") && (
                      <img
                        src={getUrl(allegato.path_file)}
                        alt={allegato.nome_file}
                        style={imageStyle}
                      />
                    )}

                    <a
                      href={getUrl(allegato.path_file)}
                      target="_blank"
                      rel="noreferrer"
                      style={linkStyle}
                    >
                      Apri allegato
                    </a>

                    <button
                      style={deleteButtonStyle}
                      onClick={() => eliminaAllegato(allegato)}
                    >
                      Elimina allegato
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
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

const backButtonStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "13px",
  marginBottom: "16px",
  border: "1.5px solid #2D2B28",
  borderRadius: "14px",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  fontWeight: "600",
  cursor: "pointer",
};

const listStyle = {
  display: "grid",
  gap: "18px",
};

const sectionStyle = {
  padding: "18px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
};

const formStyle = {
  display: "grid",
  gap: "12px",
  padding: "14px",
  marginBottom: "16px",
  borderRadius: "14px",
  backgroundColor: "#F7F5F2",
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "13px",
  borderRadius: "12px",
  border: "1px solid #D8D1CB",
};

const saveButtonStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "14px",
  border: "1px solid #2D2B28",
  borderRadius: "14px",
  backgroundColor: "#2D2B28",
  color: "#FFFFFF",
  fontWeight: "600",
  cursor: "pointer",
};

const galleryStyle = {
  display: "grid",
  gap: "14px",
};

const cardStyle = {
  padding: "14px",
  borderRadius: "14px",
  backgroundColor: "#F7F5F2",
  border: "1px solid #D8D1CB",
};

const imageStyle = {
  width: "100%",
  maxHeight: "280px",
  objectFit: "cover",
  borderRadius: "14px",
  margin: "10px 0",
};

const linkStyle = {
  display: "block",
  marginTop: "10px",
  color: "#2D2B28",
  fontWeight: "600",
};

const labelStyle = {
  color: "#6B645C",
  fontWeight: "600",
};

const deleteButtonStyle = {
  width: "100%",
  marginTop: "14px",
  padding: "12px",
  border: "1px solid #8B0000",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  color: "#8B0000",
  fontWeight: "600",
  cursor: "pointer",
};

const emptyTextStyle = {
  color: "#6B645C",
  fontSize: "14px",
};
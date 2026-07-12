import { useEffect, useState } from "react";
import { supabase } from "../services/reportSupabase";

export default function Utenti() {
  const [sezione, setSezione] = useState("utenti");
  const [utenti, setUtenti] = useState([]);
  const [beauty, setBeauty] = useState([]);
  const [agent, setAgent] = useState([]);
  const [ricerca, setRicerca] = useState("");

  const [mostraForm, setMostraForm] = useState(false);
  const [modifica, setModifica] = useState(null);

  const [ruolo, setRuolo] = useState("beauty");
  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [telefono, setTelefono] = useState("");
  const [agentId, setAgentId] = useState("");
  const [attivo, setAttivo] = useState(true);

  useEffect(() => {
    caricaDati();
  }, []);

  async function caricaDati() {
    const utentiRes = await supabase.from("utenti").select("*").order("nome");

    const beautyRes = await supabase
      .from("beauty_consultant")
      .select("*")
      .eq("attivo", true)
      .order("cognome");

    const agentRes = await supabase.from("agent").select("*").order("cognome");

    if (utentiRes.error) return alert(utentiRes.error.message);
    if (beautyRes.error) return alert(beautyRes.error.message);
    if (agentRes.error) return alert(agentRes.error.message);

    setUtenti(utentiRes.data || []);
    setBeauty(beautyRes.data || []);
    setAgent(agentRes.data || []);
  }

  function nomeCompleto(x) {
    return `${x.cognome || ""} ${x.nome || ""}`.trim();
  }

  function getAgentNome(id) {
    const a = agent.find((x) => x.id === id);
    return a ? nomeCompleto(a) : "";
  }

  function resetForm() {
    setModifica(null);
    setRuolo("beauty");
    setNome("");
    setCognome("");
    setEmail("");
    setPassword("");
    setTelefono("");
    setAgentId("");
    setAttivo(true);
  }

  function apriNuovo(tipo) {
    resetForm();
    setRuolo(tipo);
    setMostraForm(true);
  }

  function apriModificaUtente(u) {
    resetForm();
    setModifica({ tipo: "utente", id: u.id });
    setRuolo(u.ruolo || "beauty");
    setNome(u.nome || "");
    setCognome(u.cognome || "");
    setEmail(u.email || "");
    setTelefono(u.telefono || "");
    setAttivo(u.attivo !== false);
    setMostraForm(true);
  }

  function apriModificaAgent(a) {
    resetForm();
    setModifica({ tipo: "agent", id: a.id });
    setRuolo("agent");
    setNome(a.nome || "");
    setCognome(a.cognome || "");
    setEmail(a.email || "");
    setTelefono(a.telefono || "");
    setAttivo(a.attivo !== false);
    setMostraForm(true);
  }

  function apriModificaBeauty(b) {
    resetForm();
    setModifica({ tipo: "beauty", id: b.id });
    setRuolo("beauty");
    setNome(b.nome || "");
    setCognome(b.cognome || "");
    setEmail(b.email || "");
    setTelefono(b.telefono || "");
    setAgentId(b.agent_id || "");
    setMostraForm(true);
  }

  async function salva(e) {
    e.preventDefault();

    try {
      if (modifica) {
        const { data, error } = await supabase.functions.invoke(
          "update-user-profile",
          {
            body: {
              tipo: modifica.tipo,
              id: modifica.id,
              nome,
              cognome,
              email,
              telefono,
              agent_id: ruolo === "beauty" ? agentId || null : null,
              attivo,
              password: password || null,
            },
          }
        );

        if (error) throw new Error(error.message);
        if (data?.success === false) throw new Error(data.error);
      } else {
        const { data, error } = await supabase.functions.invoke(
          "create-user-profile",
          {
            body: {
              ruolo,
              nome,
              cognome,
              email,
              password,
              telefono,
              agent_id: ruolo === "beauty" ? agentId || null : null,
            },
          }
        );

        if (error) throw new Error(error.message);
        if (data?.success === false) throw new Error(data.error);
      }

      alert(
        modifica
          ? "Dati aggiornati correttamente"
          : "Utente creato correttamente"
      );

      resetForm();
      setMostraForm(false);
      await caricaDati();
    } catch (err) {
      alert(err.message);
    }
  }

  async function elimina(tipo, item) {
    const nomeItem = tipo === "utente" ? item.nome : nomeCompleto(item);
    if (!window.confirm(`Vuoi eliminare "${nomeItem}"?`)) return;

    const { data, error } = await supabase.functions.invoke(
      "delete-user-profile",
      {
        body: { tipo, id: item.id },
      }
    );

    if (error) return alert(error.message);
    if (data?.success === false) return alert(data.error);

    alert("Eliminato correttamente");
    await caricaDati();
  }

  const utentiFiltrati = utenti.filter((u) =>
    `${u.nome || ""} ${u.cognome || ""} ${u.email || ""} ${u.ruolo || ""}`
      .toLowerCase()
      .includes(ricerca.toLowerCase())
  );

  const agentFiltrati = agent.filter((a) =>
    `${a.nome || ""} ${a.cognome || ""} ${a.email || ""}`
      .toLowerCase()
      .includes(ricerca.toLowerCase())
  );

  const beautyFiltrate = beauty.filter((b) =>
    `${b.nome || ""} ${b.cognome || ""} ${b.email || ""} ${getAgentNome(
      b.agent_id
    )}`
      .toLowerCase()
      .includes(ricerca.toLowerCase())
  );

  return (
    <div>
      <div style={headerStyle}>
        <h2>Utenti</h2>
        <p style={subtitleStyle}>Gestisci utenti, agenti e beauty consultant</p>
      </div>

      <div style={tabsStyle}>
        <button
          style={sezione === "utenti" ? activeTabStyle : tabStyle}
          onClick={() => setSezione("utenti")}
        >
          Utenti
        </button>

        <button
          style={sezione === "agent" ? activeTabStyle : tabStyle}
          onClick={() => setSezione("agent")}
        >
          Agenti
        </button>

        <button
          style={sezione === "beauty" ? activeTabStyle : tabStyle}
          onClick={() => setSezione("beauty")}
        >
          Beauty
        </button>
      </div>

      <input
        style={searchStyle}
        placeholder="Ricerca rapida..."
        value={ricerca}
        onChange={(e) => setRicerca(e.target.value)}
      />

      {mostraForm && (
        <form onSubmit={salva} style={formStyle}>
          <button
            type="button"
            style={backButtonStyle}
            onClick={() => {
              resetForm();
              setMostraForm(false);
            }}
          >
            ← Torna indietro
          </button>

          <label style={labelStyle}>Nome</label>
          <input
            style={inputStyle}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
          />

          {(ruolo === "admin" ||
            ruolo === "agent" ||
            ruolo === "beauty" ||
            ruolo === "sales_manager") && (
            <>
              <label style={labelStyle}>Cognome</label>
              <input
                style={inputStyle}
                value={cognome}
                onChange={(e) => setCognome(e.target.value)}
                required
              />

              <label style={labelStyle}>Telefono</label>
              <input
                style={inputStyle}
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
              />
            </>
          )}

          <label style={labelStyle}>Email login</label>
          <input
            style={inputStyle}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label style={labelStyle}>
            {modifica
              ? "Nuova password login (lascia vuoto se non vuoi cambiarla)"
              : "Password login"}
          </label>

          <input
            style={inputStyle}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={!modifica}
          />

          <label style={labelStyle}>Ruolo</label>
          <select
            style={inputStyle}
            value={ruolo}
            onChange={(e) => setRuolo(e.target.value)}
            disabled={!!modifica}
          >
            <option value="admin">Admin</option>
            <option value="sales_manager">Sales Manager</option>
            <option value="agent">Agent</option>
            <option value="beauty">Beauty</option>
          </select>

          {ruolo === "beauty" && (
            <>
              <label style={labelStyle}>Agente collegato</label>
              <select
                style={inputStyle}
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
              >
                <option value="">Nessun agente</option>
                {agent.map((a) => (
                  <option key={a.id} value={a.id}>
                    {nomeCompleto(a)}
                  </option>
                ))}
              </select>
            </>
          )}

          {(ruolo === "admin" ||
            ruolo === "agent" ||
            ruolo === "sales_manager" ||
            modifica?.tipo === "utente") && (
            <label style={checkStyle}>
              <input
                type="checkbox"
                checked={attivo}
                onChange={(e) => setAttivo(e.target.checked)}
              />
              Attivo
            </label>
          )}

          <button style={saveButtonStyle} type="submit">
            {modifica ? "Aggiorna" : "Crea"}
          </button>
        </form>
      )}

      {!mostraForm && sezione === "utenti" && (
        <>
          <button
            style={primaryButtonStyle}
            onClick={() => apriNuovo("admin")}
          >
            + Nuovo admin
          </button>

          <button
            style={primaryButtonStyle}
            onClick={() => apriNuovo("sales_manager")}
          >
            + Nuovo sales manager
          </button>

          <div style={listStyle}>
            {utentiFiltrati.map((u) => (
              <div key={u.id} style={cardStyle}>
                <h3>{`${u.nome || ""} ${u.cognome || ""}`.trim()}</h3>
                {u.telefono && (
                  <p>
                    <span style={labelStyle}>Telefono:</span> {u.telefono}
                  </p>
                )}
                <p>
                  <span style={labelStyle}>Email:</span> {u.email}
                </p>
                <p>
                  <span style={labelStyle}>Ruolo:</span> {u.ruolo}
                </p>
                <p>
                  <span style={labelStyle}>Stato:</span>{" "}
                  {u.attivo === false ? "Disabilitato" : "Attivo"}
                </p>

                <div style={actionRowStyle}>
                  <button
                    style={editButtonStyle}
                    onClick={() => apriModificaUtente(u)}
                  >
                    Modifica
                  </button>
                  <button
                    style={deleteButtonStyle}
                    onClick={() => elimina("utente", u)}
                  >
                    Elimina
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!mostraForm && sezione === "agent" && (
        <>
          <button
            style={primaryButtonStyle}
            onClick={() => apriNuovo("agent")}
          >
            + Nuovo agente
          </button>

          <div style={listStyle}>
            {agentFiltrati.map((a) => (
              <div key={a.id} style={cardStyle}>
                <h3>{nomeCompleto(a)}</h3>
                {a.telefono && (
                  <p>
                    <span style={labelStyle}>Telefono:</span> {a.telefono}
                  </p>
                )}
                {a.email && (
                  <p>
                    <span style={labelStyle}>Email:</span> {a.email}
                  </p>
                )}
                <p>
                  <span style={labelStyle}>Stato:</span>{" "}
                  {a.attivo === false ? "Non attivo" : "Attivo"}
                </p>

                <div style={actionRowStyle}>
                  <button
                    style={editButtonStyle}
                    onClick={() => apriModificaAgent(a)}
                  >
                    Modifica
                  </button>
                  <button
                    style={deleteButtonStyle}
                    onClick={() => elimina("agent", a)}
                  >
                    Elimina
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!mostraForm && sezione === "beauty" && (
        <>
          <button
            style={primaryButtonStyle}
            onClick={() => apriNuovo("beauty")}
          >
            + Nuova beauty
          </button>

          <div style={listStyle}>
            {beautyFiltrate.map((b) => (
              <div key={b.id} style={cardStyle}>
                <h3>{nomeCompleto(b)}</h3>
                {b.telefono && (
                  <p>
                    <span style={labelStyle}>Telefono:</span> {b.telefono}
                  </p>
                )}
                {b.email && (
                  <p>
                    <span style={labelStyle}>Email:</span> {b.email}
                  </p>
                )}
                <p>
                  <span style={labelStyle}>Agente:</span>{" "}
                  {getAgentNome(b.agent_id) || "-"}
                </p>

                <div style={actionRowStyle}>
                  <button
                    style={editButtonStyle}
                    onClick={() => apriModificaBeauty(b)}
                  >
                    Modifica
                  </button>
                  <button
                    style={deleteButtonStyle}
                    onClick={() => elimina("beauty", b)}
                  >
                    Elimina
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const headerStyle = { marginBottom: "22px", textAlign: "center" };
const subtitleStyle = { fontSize: "14px", color: "#6B645C" };

const tabsStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: "8px",
  marginBottom: "18px",
};

const tabStyle = {
  padding: "12px",
  border: "1px solid #D8D1CB",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  fontWeight: "600",
  cursor: "pointer",
};

const activeTabStyle = {
  ...tabStyle,
  backgroundColor: "#2D2B28",
  color: "#FFFFFF",
};

const searchStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "15px",
  marginBottom: "14px",
  borderRadius: "14px",
  border: "1.5px solid #2D2B28",
};

const primaryButtonStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "15px",
  marginBottom: "20px",
  border: "1px solid #6B645C",
  borderRadius: "16px",
  backgroundColor: "#6B645C",
  color: "#FFFFFF",
  fontWeight: "600",
  cursor: "pointer",
};

const saveButtonStyle = {
  ...primaryButtonStyle,
  backgroundColor: "#2D2B28",
  border: "1px solid #2D2B28",
  marginBottom: 0,
};

const backButtonStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "13px",
  border: "1.5px solid #2D2B28",
  borderRadius: "14px",
  backgroundColor: "#FFFFFF",
  color: "#2D2B28",
  fontWeight: "600",
  cursor: "pointer",
};

const formStyle = {
  display: "grid",
  gap: "12px",
  padding: "20px",
  marginBottom: "24px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
};

const inputStyle = {
  padding: "14px",
  borderRadius: "12px",
  border: "1px solid #D8D1CB",
};

const checkStyle = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  fontWeight: "600",
};

const listStyle = { display: "grid", gap: "16px" };

const cardStyle = {
  padding: "20px",
  borderRadius: "18px",
  backgroundColor: "#FFFFFF",
  border: "1.5px solid #2D2B28",
  lineHeight: "1.6",
};

const labelStyle = { color: "#6B645C", fontWeight: "600" };

const actionRowStyle = {
  display: "flex",
  gap: "10px",
  marginTop: "16px",
};

const editButtonStyle = {
  flex: 1,
  padding: "10px",
  border: "1px solid #B8ADA4",
  borderRadius: "12px",
  backgroundColor: "#F7F5F2",
  fontWeight: "600",
  cursor: "pointer",
};

const deleteButtonStyle = {
  flex: 1,
  padding: "10px",
  border: "1px solid #8B0000",
  borderRadius: "12px",
  backgroundColor: "#FFFFFF",
  color: "#8B0000",
  fontWeight: "600",
  cursor: "pointer",
};
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { agentDisplayName, loadAgentNameMap } from "../services/agentNames";

function labelFor(key) {
  return String(key || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Sì" : "No";
  return String(value);
}

export default function CustomerDetail() {
  const navigate = useNavigate();
  const { customerCode } = useParams();
  const [customer, setCustomer] = useState(null);
  const [agentNames, setAgentNames] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      setError("");

      const { data, error: customerError } = await supabase
        .from("ordini_clienti_cache")
        .select("*")
        .eq("codice_cliente", customerCode)
        .maybeSingle();

      if (!active) return;
      if (customerError) {
        setError(customerError.message || "Impossibile caricare il cliente.");
        setLoading(false);
        return;
      }
      if (!data) {
        setError("Cliente non trovato.");
        setLoading(false);
        return;
      }

      setCustomer(data);
      try {
        setAgentNames(await loadAgentNameMap([data.codice_agente_mexal]));
      } catch (agentError) {
        console.warn("Impossibile caricare il nominativo agente:", agentError);
      }
      setLoading(false);
    })();

    return () => { active = false; };
  }, [customerCode]);

  const { scalarFields, objectFields } = useMemo(() => {
    const scalars = [];
    const objects = [];

    Object.entries(customer || {}).forEach(([key, value]) => {
      if (value && typeof value === "object") objects.push([key, value]);
      else scalars.push([key, value]);
    });

    return { scalarFields: scalars, objectFields: objects };
  }, [customer]);

  if (loading) return <div className="orders-empty">Caricamento cliente...</div>;

  return (
    <div className="orders-page">
      <div className="orders-new-header">
        <button className="orders-secondary" type="button" onClick={() => navigate("/ordini/clienti")}>
          <ArrowLeft size={18} /> Torna ai clienti
        </button>
        <div>
          <h2>{customer?.ragione_sociale || "Scheda cliente"}</h2>
          <p>{customer?.localita || ""}{customer?.provincia ? ` (${customer.provincia})` : ""}</p>
        </div>
      </div>

      {error && <div className="orders-alert orders-alert-error">{error}</div>}

      {customer && (
        <>
          <section className="orders-panel orders-order-section">
            <h3>Informazioni cliente</h3>
            <div className="orders-calculation-detail">
              <div><span>Agente</span><strong>{agentDisplayName(customer, agentNames)}</strong></div>
              {scalarFields.map(([key, value]) => (
                <div key={key}>
                  <span>{labelFor(key)}</span>
                  <strong>{displayValue(value)}</strong>
                </div>
              ))}
            </div>
          </section>

          {objectFields.map(([key, value]) => (
            <section className="orders-panel orders-order-section" key={key}>
              <h3>{labelFor(key)}</h3>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>
                {JSON.stringify(value, null, 2)}
              </pre>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

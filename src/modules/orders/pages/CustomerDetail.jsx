import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { agentDisplayName, loadAgentNameMap } from "../services/agentNames";
import { useOrdersModule } from "../ordersModuleContext";

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
  const { basePath } = useOrdersModule();
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

  const scalarFields = useMemo(() =>
    Object.entries(customer || {}).filter(([, value]) => !value || typeof value !== "object"),
  [customer]);

  if (loading) return <div className="orders-empty">Caricamento cliente...</div>;

  return (
    <div className="orders-page">
      <div className="orders-new-header">
        <button className="orders-secondary" type="button" onClick={() => navigate(`${basePath}/clienti`)}>
          <ArrowLeft size={18} /> Torna ai clienti
        </button>
        <div>
          <h2>{customer?.ragione_sociale || "Scheda cliente"}</h2>
          <p>{customer?.localita || ""}{customer?.provincia ? ` (${customer.provincia})` : ""}</p>
        </div>
      </div>

      {error && <div className="orders-alert orders-alert-error">{error}</div>}

      {customer && (
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
      )}
    </div>
  );
}

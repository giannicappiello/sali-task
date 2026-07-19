import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import OrdersDocumentSeriesSettings from "../../../components/OrdersDocumentSeriesSettings";

export default function DocumentSeriesSettings() {
  const navigate = useNavigate();

  return (
    <div className="integrations-page">
      <button type="button" className="integrations-back-button" onClick={() => navigate("/integrations")}>
        <ArrowLeft size={18} />
        Centro Integrazioni
      </button>
      <div className="integrations-hero">
        <div>
          <span className="integrations-eyebrow">MEXAL ERP</span>
          <h1>Serie documenti Mexal</h1>
          <p>Gestisci le serie sincronizzate e seleziona quelle usate per generare gli ordini OCM e OCX.</p>
        </div>
      </div>
      <OrdersDocumentSeriesSettings canManage />
    </div>
  );
}

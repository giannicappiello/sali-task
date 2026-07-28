import { Activity, CalendarHeart, FileText, ShoppingCart } from "lucide-react";
import { useNavigate } from "react-router-dom";

const cards = [
  { path: "fatture", title: "Fatture", text: "FTE, FTS e COX per periodo, cliente, agente e prodotto.", icon: FileText },
  { path: "ordini-ph", title: "Ordini PH", text: "Ordini, stati, clienti, agenti, prodotti e valori economici.", icon: ShoppingCart },
  { path: "beauty-days", title: "Beauty Days", text: "Analisi completa di giornate, farmacie, beauty e vendite.", icon: CalendarHeart },
  { path: "attivita", title: "Attività", text: "Progetti, fasi, reminder, scadenze e ritardi.", icon: Activity },
];

export default function AnalyticsHub() {
  const navigate = useNavigate();
  return <>
    <div className="page-title-row"><div><h1>Analisi dati</h1><p>Cruscotti, pivot ed esportazioni Excel dell’intero Workspace.</p></div></div>
    <div className="analytics-card-grid">
      {cards.map(({ path, title, text, icon: Icon }) => <button key={path} className="panel analytics-card" type="button" onClick={() => navigate(path)}>
        <span className="analytics-card-icon"><Icon size={25} /></span>
        <span><strong>{title}</strong><small>{text}</small></span>
      </button>)}
    </div>
  </>;
}

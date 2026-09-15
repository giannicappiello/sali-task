import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

export default function RdpPriorityLink({ to = "/revisione-priorita-produzione" }) {
  return <Link className="secondary-action rdp-priority-action" to={to} title="Anticipa produzione e gestisci le revisioni di priorità">
    <ArrowUpRight size={18} aria-hidden="true"/>
    <span>Anticipa produzione</span>
  </Link>;
}

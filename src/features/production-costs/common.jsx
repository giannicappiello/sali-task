import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Factory, X } from "lucide-react";
import "./production-costs.css";
export function Heading({title,children}) {
 return <header className="pc-heading"><Link to="/home"><ArrowLeft size={18}/>Workspace</Link><div><Factory size={40}/><section><small>SCHERMATA WORKSPACE</small><h1>{title}</h1><p>{children}</p></section></div></header>;
}
export function Field({label,children}) {return <label className="pc-field"><span>{label}</span>{children}</label>;}
export function Numeric({value,onChange,...props}) {return <input type="number" min="0" step="0.01" value={value??""} onChange={e=>onChange(e.target.value)} {...props}/>;}
export function Modal({title,onClose,children}) {
 const ref=useRef(null);
 useEffect(()=>{const d=ref.current;d.showModal();return()=>d.close();},[]);
 return <dialog ref={ref} className="pc-modal" data-column-controls="off" onCancel={onClose}><header><h2>{title}</h2><button aria-label="Chiudi dettaglio" onClick={onClose}><X/></button></header>{children}</dialog>;
}

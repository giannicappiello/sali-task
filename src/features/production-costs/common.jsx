import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import "./production-costs.css";
export function Field({label,children}) {return <label className="pc-field"><span>{label}</span>{children}</label>;}
export function Numeric({value,onChange,...props}) {return <input type="number" min="0" step="0.01" value={value??""} onChange={e=>onChange(e.target.value)} {...props}/>;}
export function Modal({title,onClose,children,className=''}) {
 const ref=useRef(null);
 useEffect(()=>{const d=ref.current;d.showModal();return()=>d.close();},[]);
 return <dialog ref={ref} className={`pc-modal ${className}`} data-column-controls="off" onCancel={onClose}><header><h2>{title}</h2><button type="button" aria-label="Chiudi dettaglio" onClick={onClose}><X/></button></header>{children}</dialog>;
}

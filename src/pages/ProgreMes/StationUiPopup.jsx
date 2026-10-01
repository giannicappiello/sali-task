import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./station-ui-popup.css";
export default function StationUiPopup({ station, onClose, children }) {
  const dialog = useRef(null);
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close(); }, []);
  return createPortal(<dialog ref={dialog} className="station-ui-popup" aria-label={"Station " + station} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="station-ui-popup-header"><strong>Station · {station}</strong><button type="button" aria-label="Chiudi Station" onClick={onClose} autoFocus>×</button></header>
    <div className="station-ui-popup-content">{children}</div>
  </dialog>, document.body);
}

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { stationPopupSize } from "./stationPopupSize.js";
import "./station-ui-popup.css";
export default function StationUiPopup({ station, onClose, children }) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    let dimensions;
    const fit = () => {
      if (!dimensions) return;
      const header = element.querySelector("header").getBoundingClientRect().height;
      const content = element.querySelector(".station-ui-popup-content");
      const chromeHeight = header + parseFloat(getComputedStyle(content).paddingBottom);
      const size = stationPopupSize(dimensions, {
        width: window.visualViewport?.width || window.innerWidth,
        height: window.visualViewport?.height || window.innerHeight,
      }, chromeHeight);
      if (!size) return;
      element.style.width = `${size.width}px`;
      element.style.height = `${size.height}px`;
    };
    const receive = event => {
      const frame = element.querySelector("iframe[data-assistant-mes-frame]");
      if (!frame || event.source !== frame.contentWindow || event.origin !== new URL(frame.src).origin || event.data?.type !== "progremes-station-size") return;
      const { width, height } = event.data;
      if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0 || width > 4096 || height > 20000) return;
      dimensions = { width, height };
      fit();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element.querySelector("header"));
    window.addEventListener("message", receive);
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    element.showModal();
    return () => {
      observer.disconnect();
      window.removeEventListener("message", receive);
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      element.close();
    };
  }, []);
  return createPortal(<dialog ref={dialog} className="station-ui-popup" aria-label={"Station " + station} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="station-ui-popup-header"><strong>Station · {station}</strong><button type="button" aria-label="Chiudi Station" onClick={onClose} autoFocus>×</button></header>
    <div className="station-ui-popup-content">{children}</div>
  </dialog>, document.body);
}
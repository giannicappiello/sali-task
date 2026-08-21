import { CalendarClock, ShoppingCart, Sparkles, X } from "lucide-react";
import { createPortal } from "react-dom";

export default function AIOrderTypeDialog({ open, onClose, onSelect }) {
  if (!open) return null;

  return createPortal(
    <div
      className="orders-ai-type-overlay"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        className="orders-ai-type-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="orders-ai-type-title"
      >
        <div className="orders-ai-type-heading">
          <div>
            <span><Sparkles size={17} /> Generazione con AI</span>
            <h2 id="orders-ai-type-title">Quale ordine vuoi generare?</h2>
            <p>La scelta verrà mantenuta durante la lettura del documento e la compilazione della bozza.</p>
          </div>
          <button className="orders-ai-type-close" type="button" onClick={onClose} aria-label="Chiudi"><X size={20} /></button>
        </div>
        <div className="orders-ai-type-options">
          <button type="button" onClick={() => onSelect("standard")}>
            <ShoppingCart size={24} />
            <span><strong>Nuovo ordine</strong><small>Genera una bozza di ordine standard.</small></span>
          </button>
          <button type="button" onClick={() => onSelect("prenotazione")}>
            <CalendarClock size={24} />
            <span><strong>Ordine prenotazione</strong><small>Genera una bozza dedicata alla prenotazione.</small></span>
          </button>
        </div>
        <div className="orders-ai-type-actions"><button className="orders-secondary" type="button" onClick={onClose}>Annulla</button></div>
      </section>
    </div>,
    document.body,
  );
}

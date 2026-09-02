import InfoTooltip from "../../../components/InfoTooltip";

const ORDER_STATUS_OPTIONS = Object.freeze([
  Object.freeze({ value: "bozza", label: "Bozza" }),
  Object.freeze({ value: "in_corso", label: "In corso" }),
  Object.freeze({ value: "spedito", label: "Spedito" }),
  Object.freeze({ value: "inviato-mexal", label: "Inviato a Mexal" }),
  Object.freeze({ value: "annullato", label: "Non presente in Mexal" }),
  Object.freeze({ value: "evaso", label: "Evaso" }),
  Object.freeze({ value: "errore", label: "Errore" }),
]);

export default function OrdersStatusFilter({ value, onChange, options = ORDER_STATUS_OPTIONS }) {
  return (
    <label className="orders-status-filter">
      <span>
        Stato
        <InfoTooltip
          label="Filtro stato"
          text="Mostra soltanto gli ordini che si trovano nello stato selezionato. Scegli Tutti gli stati per rimuovere il filtro."
        />
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label="Filtra ordini per stato">
        <option value="">Tutti gli stati</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

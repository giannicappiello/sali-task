import { screenAreaCodes } from "../../config/workspaceScreenAreas";

export default function ScreenAreaPicker({ screen, areas, disabled, onChange }) {
  const selected = screenAreaCodes(screen);
  return <fieldset className="wide screen-area-picker" disabled={disabled}>
    <legend>Aree della schermata</legend>
    <p>Basta l’accesso a una delle aree selezionate per visualizzare la schermata. Restano valide le eccezioni personali.</p>
    <div className="screen-area-options">
      {areas.filter((area) => area.attiva || selected.includes(area.codice)).map((area) =>
        <label key={area.codice}><input type="checkbox" checked={selected.includes(area.codice)}
          onChange={(event) => onChange(event.target.checked ? [...selected, area.codice] : selected.filter((code) => code !== area.codice))} />
          <span>{area.nome}{!area.attiva ? " (disattivata)" : ""}</span></label>)}
    </div>
    {!selected.length && <small role="alert">Seleziona almeno un’area prima di salvare.</small>}
  </fieldset>;
}

import { ExternalLink, FileText, Images } from "lucide-react";

const TECHNICAL_SHEETS_URL =
  "https://1drv.ms/f/c/e09335f01b96c207/IgCmA5Por2UiQZEsuruP1juxAY6k2ZdJBQQWEUNEZbzVSCg?e=dZwwFI";

const ADVERTISING_MATERIALS_URL =
  "https://1drv.ms/f/c/e09335f01b96c207/IgCcVrw2YQERT4iWOFyy9icuAXp-b59siwSiGkDfis2n__Q?e=xzOZnM";

export default function Documentation() {
  function openFolder(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="documentation-page v4-page">
      <div className="page-title-row">
        <div>
          <h1>Documentazione</h1>
          <p>Accedi alle cartelle aziendali e scarica i documenti necessari.</p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "20px",
        }}
      >
        <article className="panel" style={{ display: "grid", gap: "16px" }}>
          <div className="panel-header">
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <FileText size={26} />
              <div>
                <h3>Schede Tecniche</h3>
                <p>Consulta e scarica le schede tecniche aggiornate.</p>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="primary-action"
            onClick={() => openFolder(TECHNICAL_SHEETS_URL)}
          >
            <ExternalLink size={18} />
            Apri cartella
          </button>
        </article>

        <article className="panel" style={{ display: "grid", gap: "16px" }}>
          <div className="panel-header">
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <Images size={26} />
              <div>
                <h3>Materiali Pubblicitari</h3>
                <p>Consulta e scarica cataloghi, immagini e materiali commerciali.</p>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="primary-action"
            onClick={() => openFolder(ADVERTISING_MATERIALS_URL)}
          >
            <ExternalLink size={18} />
            Apri cartella
          </button>
        </article>
      </div>
    </div>
  );
}

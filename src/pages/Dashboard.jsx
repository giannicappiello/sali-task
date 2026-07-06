import {
  ListChecks,
  Clock,
  AlertCircle,
  CheckCircle2,
  Plus,
  Upload,
  CalendarDays,
} from "lucide-react";

function Dashboard() {
  return (
    <div className="dashboard-page">
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon blue">
            <ListChecks size={26} />
          </div>
          <div>
            <span>Task aperte</span>
            <strong>42</strong>
            <p>↗ +12% vs settimana scorsa</p>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon orange">
            <Clock size={26} />
          </div>
          <div>
            <span>In scadenza oggi</span>
            <strong>6</strong>
            <p>↗ +2 rispetto a ieri</p>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon red">
            <AlertCircle size={26} />
          </div>
          <div>
            <span>Scadute</span>
            <strong>3</strong>
            <p>↗ +1 rispetto a ieri</p>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon green">
            <CheckCircle2 size={26} />
          </div>
          <div>
            <span>Completate oggi</span>
            <strong>12</strong>
            <p>↗ +20% vs ieri</p>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="panel large">
          <div className="panel-header">
            <h3>Task in scadenza</h3>
            <button>Vai a tutte</button>
          </div>

          <div className="task-list">
            {[
              ["Revisione formula Shampoo Riparatore", "Nuovo prodotto", "Shampoo Riparatore", "MR", "17 Mag 2025"],
              ["Approvazione pack primario", "Prodotto esistente", "Balsamo Nutriente", "LC", "17 Mag 2025"],
              ["Test di stabilità accelerata", "Nuovo prodotto", "Siero Viso Illuminante", "FS", "18 Mag 2025"],
              ["Definizione claim e benefit", "Nuovo progetto", "Rebranding linea viso", "GC", "19 Mag 2025"],
              ["Brief agenzia comunicazione", "Intervento generico", "Campagna Autunno", "AD", "19 Mag 2025"],
            ].map((task, index) => (
              <div className="task-row" key={index}>
                <div>
                  <strong>{task[0]}</strong>
                  <span className={`badge badge-${index}`}>{task[1]}</span>
                </div>
                <span>{task[2]}</span>
                <em>{task[3]}</em>
                <b>{task[4]}</b>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Avanzamento progetti</h3>
            <button>Vai a tutti</button>
          </div>

          {[
            ["Nuova linea solari 2027", 65],
            ["Shampoo Riparatore", 40],
            ["Rebranding linea viso", 30],
            ["Siero Viso Illuminante", 25],
            ["Campagna Autunno", 15],
          ].map((item, index) => (
            <div className="progress-row" key={index}>
              <div>
                <span>{item[0]}</span>
                <strong>{item[1]}%</strong>
              </div>
              <div className="progress-track">
                <div style={{ width: `${item[1]}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="panel calendar-panel">
          <div className="panel-header">
            <h3>Calendario</h3>
            <button>Oggi</button>
          </div>

          <h4>Maggio 2025</h4>

          <div className="mini-calendar">
            {["LUN", "MAR", "MER", "GIO", "VEN", "SAB", "DOM"].map((d) => (
              <span key={d}>{d}</span>
            ))}
            {Array.from({ length: 35 }).map((_, i) => (
              <button key={i} className={i === 18 ? "selected" : ""}>
                {i + 1 <= 31 ? i + 1 : ""}
              </button>
            ))}
          </div>

          <div className="calendar-events">
            <p><b>10:00</b> Riunione progetto Solari 2027</p>
            <p><b>14:30</b> Review pack secondario</p>
            <p><b>16:00</b> Allineamento team R&S</p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Attività recenti</h3>
            <button>Vai a tutte</button>
          </div>

          <div className="activity-list">
            <p><b>Marco Rossi</b> ha completato la task “Analisi benchmark mercato”</p>
            <p><b>Laura Conti</b> ha commentato “Definizione formula base”</p>
            <p>È stato caricato un nuovo documento in “Shampoo Riparatore”</p>
            <p><b>Giulia Conti</b> ha aggiornato il progetto “Rebranding linea viso”</p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Carico di lavoro del team</h3>
            <button>Vai al team</button>
          </div>

          {[
            ["Marco Rossi", "R&S", 95],
            ["Laura Conti", "Packaging", 80],
            ["Francesca Sala", "R&S", 65],
            ["Alessandro De Luca", "Marketing", 45],
            ["Giulia Conti", "Product Manager", 40],
          ].map((person, index) => (
            <div className="team-load" key={index}>
              <div className="mini-avatar">{person[0].slice(0, 2)}</div>
              <div>
                <strong>{person[0]}</strong>
                <span>{person[1]}</span>
              </div>
              <div className="load-bar">
                <div style={{ width: `${person[2]}%` }} />
              </div>
              <b>{person[2]}%</b>
            </div>
          ))}
        </div>

        <div className="panel quick-panel">
          <h3>Azioni rapide</h3>
          <button><Plus size={18} /> Nuova task</button>
          <button><Plus size={18} /> Nuovo progetto</button>
          <button><Plus size={18} /> Nuovo prodotto</button>
          <button><Upload size={18} /> Carica documento</button>
          <button><CalendarDays size={18} /> Programma riunione</button>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;